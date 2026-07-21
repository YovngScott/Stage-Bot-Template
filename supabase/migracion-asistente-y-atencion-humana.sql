-- ============================================================================
-- MIGRACIÓN — Asistente virtual + arreglo de solicitudes de atención humana
--
-- CÓRRELA ANTES de desplegar el backend nuevo. El backend consulta la columna
-- `atencion_humana_pendiente`; si despliegas primero y la columna no existe,
-- TODAS las consultas de clientes fallan y los bots dejan de responder.
--
-- Cómo: Supabase → SQL Editor → pega esto → Run.
-- Es idempotente: puedes correrla varias veces sin romper nada.
-- Ya está incluida en schema.sql; este archivo es solo el delta, para no
-- tener que re-ejecutar el esquema completo.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. ARREGLO: las solicitudes de atención humana no llegaban al dashboard
--
-- "Pendiente de atención humana" y "bot pausado" son cosas DISTINTAS y ahora
-- viven en campos distintos:
--   · estado = 'requiere_humano'       → el bot se calla (solo si el cliente
--                                         lo pidió explícitamente).
--   · atencion_humana_pendiente = true → aparece en el dashboard para que el
--                                         equipo lo atienda. La IA levanta
--                                         esta bandera al escalar un caso SIN
--                                         silenciar al bot.
--
-- Cuando ambos significados compartían la columna `estado`, evitar que el bot
-- se auto-silenciara hacía desaparecer el caso del dashboard.
-- ----------------------------------------------------------------------------
alter table clientes add column if not exists atencion_humana_pendiente boolean not null default false;

-- Los chats que hoy están pausados siguen pendientes de atención.
update clientes set atencion_humana_pendiente = true
  where estado = 'requiere_humano' and atencion_humana_pendiente = false;

create index if not exists idx_clientes_atencion_pendiente
  on clientes (tenant_id, ultimo_contacto desc) where atencion_humana_pendiente;


-- ----------------------------------------------------------------------------
-- 2. ASISTENTE VIRTUAL — triaje de correo (bots con kind = 'assistant')
--
-- MINIMIZACIÓN DE DATOS (deliberada): NO se guarda el cuerpo del correo. Una
-- vez clasificado el mensaje y creado el borrador, el contenido se descarta y
-- aquí solo persisten metadatos, la clasificación y los identificadores
-- necesarios para auditar.
-- ----------------------------------------------------------------------------
create table if not exists asistente_correos (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants (id) on delete cascade,
  gmail_message_id  text not null,
  gmail_thread_id   text not null,
  remitente         text not null,
  asunto            text not null,
  recibido_en       timestamptz not null,

  filtrado_heuristica boolean not null default false,
  motivo_descarte     text,

  categoria         text,
  prioridad         text check (prioridad is null or prioridad in ('Urgent','High','Normal','Low')),
  confianza         numeric(4,3) check (confianza is null or (confianza >= 0 and confianza <= 1)),
  justificacion     text,
  requiere_accion   boolean not null default false,

  -- 'auto'     → superó el umbral, se creó borrador
  -- 'revision' → confianza baja, escalado al ejecutivo por WhatsApp
  -- 'omitido'  → descartado por la heurística
  -- 'error'    → la IA falló; se trata como revisión humana
  resultado         text not null default 'omitido'
                    check (resultado in ('auto','revision','omitido','error')),
  borrador_id       text,
  alerta_enviada    boolean not null default false,

  procesado_en      timestamptz not null default now(),
  -- Un mismo correo no se procesa (ni se cobra en tokens) dos veces.
  unique (tenant_id, gmail_message_id)
);

create index if not exists idx_asistente_correos_tenant_fecha
  on asistente_correos (tenant_id, procesado_en desc);
create index if not exists idx_asistente_correos_revision
  on asistente_correos (tenant_id, resultado) where resultado = 'revision';

-- Bitácora de cada corrida: monitorear coste y salud del pipeline sin
-- necesidad de guardar los correos.
create table if not exists asistente_ejecuciones (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants (id) on delete cascade,
  iniciado_en           timestamptz not null default now(),
  finalizado_en         timestamptz,
  revisados             integer not null default 0,
  descartados_heuristica integer not null default 0,
  clasificados          integer not null default 0,
  borradores_creados    integer not null default 0,
  escalados_revision    integer not null default 0,
  error                 text
);

create index if not exists idx_asistente_ejecuciones_tenant
  on asistente_ejecuciones (tenant_id, iniciado_en desc);


-- ----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY
--    Crítico: el proyecto de Supabase es compartido. Sin esto, el dashboard de
--    un cliente podría leer el triaje de correo de otro.
-- ----------------------------------------------------------------------------
alter table asistente_correos     enable row level security;
alter table asistente_ejecuciones enable row level security;

-- Solo lectura: quien escribe es el backend con la service_role key.
drop policy if exists dashboard_read_asistente_correos on asistente_correos;
create policy dashboard_read_asistente_correos on asistente_correos
  for select to authenticated using (tiene_acceso_tenant(tenant_id));

drop policy if exists dashboard_read_asistente_ejecuciones on asistente_ejecuciones;
create policy dashboard_read_asistente_ejecuciones on asistente_ejecuciones
  for select to authenticated using (tiene_acceso_tenant(tenant_id));


-- ----------------------------------------------------------------------------
-- 4. VERIFICACIÓN — debe devolver 3 filas
-- ----------------------------------------------------------------------------
select 'columna atencion_humana_pendiente' as verifica,
       count(*)::text as ok
  from information_schema.columns
 where table_name = 'clientes' and column_name = 'atencion_humana_pendiente'
union all
select 'tabla asistente_correos', count(*)::text
  from information_schema.tables where table_name = 'asistente_correos'
union all
select 'tabla asistente_ejecuciones', count(*)::text
  from information_schema.tables where table_name = 'asistente_ejecuciones';
