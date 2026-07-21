-- ============================================================================
--  Stage Bot Template — Esquema de base de datos MULTI-CLIENTE (Supabase / PostgreSQL)
--
--  UN SOLO proyecto de Supabase + UN SOLO backend en Fly.io atienden a TODOS
--  los clientes (tenants) del bot de WhatsApp. Cada cliente nuevo = una fila
--  en `tenants` + un archivo `config/tenants/<slug>.json` en el repo — no hace
--  falta crear infraestructura nueva.
--
--  IDEMPOTENTE: este script se puede correr las veces que hagan falta.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 0. TENANTS (clientes de Stage AI Labs — cada uno es un negocio con su bot)
-- ----------------------------------------------------------------------------
create table if not exists tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,   -- debe matchear config/tenants/<slug>.json
  nombre     text not null,          -- nombre comercial, solo para referencia humana
  -- Interruptor remoto: false = el bot sigue guardando mensajes entrantes pero
  -- no responde nada (suspendido, ej. por falta de pago). Lo controla Stage AI
  -- Labs vía POST /api/tenants/:slug/bot-activo (ver adminAuth.ts).
  bot_activo boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- Súper-admins de Stage AI Labs: ven y gestionan TODOS los tenants.
create table if not exists super_admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  creado_en timestamptz not null default now()
);

-- A qué tenant(s) tiene acceso cada usuario del dashboard (el dueño/staff de
-- CADA negocio inicia sesión con su propia cuenta, pero comparten el mismo
-- proyecto de Supabase — esta tabla + las políticas RLS de abajo son lo que
-- evita que un cliente vea los datos de otro).
create table if not exists tenant_admins (
  user_id   uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  primary key (user_id, tenant_id)
);

-- Función auxiliar para las políticas RLS de abajo.
create or replace function tiene_acceso_tenant(t_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select
    exists (select 1 from super_admins where user_id = auth.uid())
    or exists (select 1 from tenant_admins where user_id = auth.uid() and tenant_id = t_id);
$$;

-- ----------------------------------------------------------------------------
-- 1. CLIENTES (los clientes FINALES de cada negocio — quien le escribe por WhatsApp)
-- ----------------------------------------------------------------------------
do $$ begin
  create type estado_cliente as enum (
    'nuevo', 'interesado', 'cotizado', 'agendado', 'cliente', 'perdido', 'requiere_humano'
  );
exception when duplicate_object then null;
end $$;

create table if not exists clientes (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants (id) on delete cascade,
  telefono            text not null,          -- E.164, ej. +18098944655
  nombre              text,
  estado              estado_cliente not null default 'nuevo',
  etiquetas           text[] not null default '{}',
  notas               text,
  solicito_humano_en  timestamptz,
  atendido_en         timestamptz,
  ultimo_contacto     timestamptz not null default now(),
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  unique (tenant_id, telefono)
);

-- "Pendiente de atención humana" y "bot pausado" son cosas DISTINTAS y por eso
-- viven en campos distintos:
--   · estado = 'requiere_humano'       → el bot se calla (solo si el cliente lo
--                                         pidió explícitamente).
--   · atencion_humana_pendiente = true → aparece en el dashboard para que el
--                                         equipo lo atienda. La IA levanta esta
--                                         bandera al escalar un caso SIN
--                                         silenciar al bot.
-- Cuando ambos significados compartían la columna `estado`, evitar que el bot
-- se auto-silenciara hacía desaparecer el caso del dashboard.
alter table clientes add column if not exists atencion_humana_pendiente boolean not null default false;

-- Backfill: los chats que hoy están pausados siguen pendientes de atención.
update clientes set atencion_humana_pendiente = true
  where estado = 'requiere_humano' and atencion_humana_pendiente = false;

create index if not exists idx_clientes_tenant on clientes (tenant_id);
create index if not exists idx_clientes_estado on clientes (tenant_id, estado);
create index if not exists idx_clientes_creado on clientes (tenant_id, creado_en);
create index if not exists idx_clientes_atencion_pendiente
  on clientes (tenant_id, ultimo_contacto desc) where atencion_humana_pendiente;

-- ----------------------------------------------------------------------------
-- 2. MENSAJES
-- ----------------------------------------------------------------------------
do $$ begin
  create type rol_mensaje as enum ('cliente', 'bot', 'humano', 'sistema');
exception when duplicate_object then null;
end $$;

create table if not exists mensajes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  cliente_id      uuid not null references clientes (id) on delete cascade,
  rol             rol_mensaje not null,
  contenido       text not null,
  wa_message_id   text,
  tokens_entrada  integer,
  tokens_salida   integer,
  creado_en       timestamptz not null default now(),
  unique (tenant_id, wa_message_id)
);

create index if not exists idx_mensajes_cliente on mensajes (cliente_id, creado_en);
create index if not exists idx_mensajes_tenant_creado on mensajes (tenant_id, creado_en);

-- ----------------------------------------------------------------------------
-- 3. CONSULTAS ANALÍTICAS — categorías genéricas (sirven para cualquier rubro)
-- ----------------------------------------------------------------------------
do $$ begin
  create type categoria_consulta as enum (
    'precio', 'disponibilidad', 'horario_ubicacion', 'cita', 'envio', 'pago', 'garantia', 'otra'
  );
exception when duplicate_object then null;
end $$;

create table if not exists consultas_analiticas (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  cliente_id      uuid references clientes (id) on delete set null,
  mensaje_id      uuid references mensajes (id) on delete set null,
  categoria       categoria_consulta not null,
  pregunta        text not null,
  servicio_texto  text,        -- lo que pidió el cliente, exista o no en el catálogo
  servicio_id     uuid,        -- FK suave a `servicios`
  creado_en       timestamptz not null default now()
);

create index if not exists idx_consultas_tenant on consultas_analiticas (tenant_id, categoria, creado_en);

-- ----------------------------------------------------------------------------
-- 4. SERVICIOS — catálogo GENÉRICO de productos/servicios (reemplaza el
--    antiguo inventario de piezas específico de reparación de celulares).
--    Cada negocio define sus propias filas: un producto, un servicio, un
--    paquete, lo que sea que vendan.
-- ----------------------------------------------------------------------------
create table if not exists servicios (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  sku             text,
  nombre          text not null,        -- ej. "Corte de cabello", "Pantalla iPhone 11 (original)"
  categoria       text,                 -- libre, define cada negocio
  descripcion     text,
  precio          numeric(12,2) not null,
  moneda          text not null default 'USD',
  stock           integer,              -- null = no aplica (servicios sin inventario físico)
  garantia_dias   integer,
  disponible      boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index if not exists idx_servicios_tenant on servicios (tenant_id);
create index if not exists idx_servicios_busqueda on servicios
  using gin (to_tsvector('spanish', coalesce(nombre,'') || ' ' || coalesce(categoria,'') || ' ' || coalesce(descripcion,'')));
create index if not exists idx_servicios_disponible on servicios (tenant_id, disponible) where disponible;

-- ----------------------------------------------------------------------------
-- 5. CITAS
-- ----------------------------------------------------------------------------
do $$ begin
  create type estado_cita as enum ('confirmada', 'reprogramada', 'cancelada', 'completada', 'no_asistio');
exception when duplicate_object then null;
end $$;

create table if not exists citas (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants (id) on delete cascade,
  cliente_id         uuid not null references clientes (id) on delete cascade,
  google_event_id    text,
  inicio             timestamptz not null,
  fin                timestamptz not null,
  motivo             text,
  estado             estado_cita not null default 'confirmada',
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  unique (tenant_id, google_event_id)
);

create index if not exists idx_citas_tenant_inicio on citas (tenant_id, inicio);

-- ----------------------------------------------------------------------------
-- 5b. EMPLEADOS — números de WhatsApp del equipo, por tenant.
-- ----------------------------------------------------------------------------
create table if not exists empleados (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants (id) on delete cascade,
  nombre     text not null,
  telefono   text not null,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  unique (tenant_id, telefono)
);

-- ----------------------------------------------------------------------------
-- 5c/5d. GOOGLE CALENDAR — OAuth por tenant (cada negocio conecta SU propio
--    calendario). El Client ID/Secret de la app de Google Cloud puede ser
--    compartido entre todos los tenants (variable de entorno), pero el
--    refresh_token de cada negocio es suyo.
-- ----------------------------------------------------------------------------
create table if not exists google_oauth_tokens (
  tenant_id      uuid primary key references tenants (id) on delete cascade,
  refresh_token  text not null,
  access_token   text,
  expiry_date    bigint,
  cuenta_email   text,
  actualizado_en timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 6. TRIGGERS de actualizado_en
-- ----------------------------------------------------------------------------
create or replace function set_actualizado_en()
returns trigger language plpgsql as $$
begin
  new.actualizado_en = now();
  return new;
end $$;

drop trigger if exists trg_clientes_updated on clientes;
create trigger trg_clientes_updated before update on clientes
  for each row execute function set_actualizado_en();

drop trigger if exists trg_servicios_updated on servicios;
create trigger trg_servicios_updated before update on servicios
  for each row execute function set_actualizado_en();

drop trigger if exists trg_citas_updated on citas;
create trigger trg_citas_updated before update on citas
  for each row execute function set_actualizado_en();

-- ----------------------------------------------------------------------------
-- 7. VISTAS PARA EL DASHBOARD (todas por tenant_id)
-- ----------------------------------------------------------------------------
create or replace view v_metricas as
select
  t.id as tenant_id,
  (select count(distinct m.cliente_id) from mensajes m
    where m.tenant_id = t.id and m.rol = 'cliente'
      and m.creado_en >= date_trunc('day', now()))                                as clientes_activos_hoy,
  (select count(*) from clientes c
    where c.tenant_id = t.id and c.creado_en >= date_trunc('day', now()))          as clientes_nuevos_hoy,
  (select count(*) from clientes c
    where c.tenant_id = t.id and c.creado_en >= date_trunc('week', now()))         as clientes_nuevos_semana,
  (select count(*) from citas ci
    where ci.tenant_id = t.id
      and ci.inicio >= date_trunc('day', now()) and ci.inicio < date_trunc('day', now()) + interval '1 day'
      and ci.estado in ('confirmada','reprogramada'))                             as citas_hoy,
  (select count(*) from clientes c where c.tenant_id = t.id and c.estado in ('agendado','cliente')) as clientes_convertidos,
  (select count(*) from clientes c where c.tenant_id = t.id)                       as clientes_totales,
  case when (select count(*) from clientes c where c.tenant_id = t.id) = 0 then 0
       else round(100.0 * (select count(*) from clientes c where c.tenant_id = t.id and c.estado in ('agendado','cliente'))
                        / (select count(*) from clientes c where c.tenant_id = t.id), 1)
  end                                                                              as tasa_conversion_pct,
  (select count(*) from mensajes m where m.tenant_id = t.id and m.creado_en >= date_trunc('day', now())) as mensajes_hoy
from tenants t;

create or replace view v_servicios_mas_preguntados as
select
  c.tenant_id,
  coalesce(s.nombre, c.servicio_texto, 'Desconocido') as servicio,
  count(*)         as veces_preguntada,
  max(c.creado_en) as ultima_consulta
from consultas_analiticas c
left join servicios s on s.id = c.servicio_id
where c.categoria in ('precio', 'disponibilidad')
group by c.tenant_id, coalesce(s.nombre, c.servicio_texto, 'Desconocido')
order by veces_preguntada desc;

create or replace view v_preguntas_frecuentes as
select tenant_id, categoria, pregunta, count(*) as repeticiones, max(creado_en) as ultima_vez
from consultas_analiticas
group by tenant_id, categoria, pregunta
order by repeticiones desc;

create or replace view v_consultas_por_categoria as
select tenant_id, categoria, count(*) as total
from consultas_analiticas
group by tenant_id, categoria
order by total desc;

create or replace view v_embudo as
select tenant_id, estado, count(*) as total
from clientes
group by tenant_id, estado;

create or replace view v_clientes_por_dia as
select
  m.tenant_id,
  (date_trunc('day', m.creado_en))::date as dia,
  count(distinct m.cliente_id)           as activos,
  count(distinct m.cliente_id) filter (
    where c.creado_en >= date_trunc('day', m.creado_en)
  )                                       as nuevos
from mensajes m
join clientes c on c.id = m.cliente_id
where m.rol = 'cliente'
  and m.creado_en >= now() - interval '30 days'
group by m.tenant_id, (date_trunc('day', m.creado_en))::date
order by 2;

-- ----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
--    Backend: service_role key (bypassa RLS). Dashboard: Supabase Auth
--    (authenticated) + tiene_acceso_tenant() — CRÍTICO en un esquema
--    multi-cliente: sin esto, el mismo proyecto compartido dejaría que
--    cualquier dashboard viera los datos de TODOS los clientes.
-- ----------------------------------------------------------------------------
alter table tenants             enable row level security;
alter table tenant_admins       enable row level security;
alter table clientes            enable row level security;
alter table mensajes            enable row level security;
alter table consultas_analiticas enable row level security;
alter table servicios           enable row level security;
alter table citas               enable row level security;
alter table empleados           enable row level security;
alter table google_oauth_tokens enable row level security;
-- super_admins: sin políticas → nadie con la anon/authenticated key puede leer
-- ni escribir. Solo se gestiona a mano (service_role) desde Supabase.
alter table super_admins        enable row level security;

drop policy if exists tenant_admins_ve_su_tenant on tenants;
drop policy if exists dashboard_read_clientes on clientes;
drop policy if exists dashboard_read_mensajes on mensajes;
drop policy if exists dashboard_read_consultas on consultas_analiticas;
drop policy if exists dashboard_read_servicios on servicios;
drop policy if exists dashboard_read_citas on citas;
drop policy if exists dashboard_read_empleados on empleados;
drop policy if exists dashboard_read_tenant_admins on tenant_admins;

create policy tenant_admins_ve_su_tenant on tenants
  for select to authenticated using (tiene_acceso_tenant(id));

create policy dashboard_read_tenant_admins on tenant_admins
  for select to authenticated using (user_id = auth.uid());

create policy dashboard_read_clientes on clientes
  for select to authenticated using (tiene_acceso_tenant(tenant_id));
create policy dashboard_read_mensajes on mensajes
  for select to authenticated using (tiene_acceso_tenant(tenant_id));
create policy dashboard_read_consultas on consultas_analiticas
  for select to authenticated using (tiene_acceso_tenant(tenant_id));
create policy dashboard_read_servicios on servicios
  for select to authenticated using (tiene_acceso_tenant(tenant_id));
create policy dashboard_read_citas on citas
  for select to authenticated using (tiene_acceso_tenant(tenant_id));
create policy dashboard_read_empleados on empleados
  for select to authenticated using (tiene_acceso_tenant(tenant_id));

-- El dashboard también sube/edita el catálogo de servicios y empleados
-- directamente (no solo lectura), igual scopeado por tenant.
drop policy if exists dashboard_write_servicios on servicios;
create policy dashboard_write_servicios on servicios
  for all to authenticated using (tiene_acceso_tenant(tenant_id)) with check (tiene_acceso_tenant(tenant_id));

drop policy if exists dashboard_write_empleados on empleados;
create policy dashboard_write_empleados on empleados
  for all to authenticated using (tiene_acceso_tenant(tenant_id)) with check (tiene_acceso_tenant(tenant_id));
