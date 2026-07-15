-- ============================================================================
--  Migración: convertir un proyecto Supabase clonado del bot ORIGINAL de
--  Wiltech (single-tenant) al esquema multi-tenant de Stage-Bot-Template,
--  SIN perder los datos existentes. Todo lo que ya había queda bajo el tenant
--  "wiltech". Pensada para correrse UNA vez sobre ese proyecto clonado
--  específico (no es el schema.sql genérico de un proyecto vacío).
--
--  Es mayormente idempotente (usa IF NOT EXISTS / IF EXISTS), pero está
--  pensada para correrse una sola vez sobre este proyecto en particular.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- 0. Infra multi-tenant nueva (no existía en el esquema viejo)
-- ----------------------------------------------------------------------------
create table if not exists tenants (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  nombre     text not null,
  bot_activo boolean not null default true,
  creado_en  timestamptz not null default now()
);

create table if not exists super_admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  creado_en timestamptz not null default now()
);

create table if not exists tenant_admins (
  user_id   uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  primary key (user_id, tenant_id)
);

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

-- Tenant "wiltech" = dueño de todos los datos que ya existen en esta base.
insert into tenants (slug, nombre)
select 'wiltech', 'Wiltech República Dominicana'
where not exists (select 1 from tenants where slug = 'wiltech');

-- ----------------------------------------------------------------------------
-- 1. Agregar tenant_id a las tablas existentes (nullable primero, luego NOT NULL)
-- ----------------------------------------------------------------------------
alter table clientes             add column if not exists tenant_id uuid references tenants(id);
alter table mensajes             add column if not exists tenant_id uuid references tenants(id);
alter table consultas_analiticas add column if not exists tenant_id uuid references tenants(id);
alter table citas                add column if not exists tenant_id uuid references tenants(id);
alter table empleados            add column if not exists tenant_id uuid references tenants(id);

update clientes             set tenant_id = (select id from tenants where slug = 'wiltech') where tenant_id is null;
update mensajes              set tenant_id = (select id from tenants where slug = 'wiltech') where tenant_id is null;
update consultas_analiticas set tenant_id = (select id from tenants where slug = 'wiltech') where tenant_id is null;
update citas                 set tenant_id = (select id from tenants where slug = 'wiltech') where tenant_id is null;
update empleados             set tenant_id = (select id from tenants where slug = 'wiltech') where tenant_id is null;

alter table clientes             alter column tenant_id set not null;
alter table mensajes             alter column tenant_id set not null;
alter table consultas_analiticas alter column tenant_id set not null;
alter table citas                alter column tenant_id set not null;
alter table empleados            alter column tenant_id set not null;

-- ----------------------------------------------------------------------------
-- 2. Constraints "único global" -> "único por tenant"
-- ----------------------------------------------------------------------------
alter table clientes drop constraint if exists clientes_telefono_key;
alter table clientes add constraint clientes_tenant_telefono_key unique (tenant_id, telefono);

alter table mensajes drop constraint if exists mensajes_wa_message_id_key;
alter table mensajes add constraint mensajes_tenant_wa_message_id_key unique (tenant_id, wa_message_id);

alter table citas drop constraint if exists citas_google_event_id_key;
alter table citas add constraint citas_tenant_google_event_id_key unique (tenant_id, google_event_id);

alter table empleados drop constraint if exists empleados_telefono_key;
alter table empleados add constraint empleados_tenant_telefono_key unique (tenant_id, telefono);

-- ----------------------------------------------------------------------------
-- 3. Índices por tenant
-- ----------------------------------------------------------------------------
create index if not exists idx_clientes_tenant on clientes (tenant_id);
create index if not exists idx_mensajes_tenant_creado on mensajes (tenant_id, creado_en);
create index if not exists idx_consultas_tenant on consultas_analiticas (tenant_id, categoria, creado_en);
create index if not exists idx_citas_tenant_inicio on citas (tenant_id, inicio);

-- ----------------------------------------------------------------------------
-- 4. Catálogo genérico "servicios" (nuevo; inventario_piezas queda intacto)
-- ----------------------------------------------------------------------------
create table if not exists servicios (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants (id) on delete cascade,
  sku             text,
  nombre          text not null,
  categoria       text,
  descripcion     text,
  precio          numeric(12,2) not null,
  moneda          text not null default 'USD',
  stock           integer,
  garantia_dias   integer,
  disponible      boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);

create index if not exists idx_servicios_tenant on servicios (tenant_id);
create index if not exists idx_servicios_busqueda on servicios
  using gin (to_tsvector('spanish', coalesce(nombre,'') || ' ' || coalesce(categoria,'') || ' ' || coalesce(descripcion,'')));
create index if not exists idx_servicios_disponible on servicios (tenant_id, disponible) where disponible;

drop trigger if exists trg_servicios_updated on servicios;
create trigger trg_servicios_updated before update on servicios
  for each row execute function set_actualizado_en();

-- Copia el inventario real de Wiltech al catálogo genérico nuevo (una vez).
insert into servicios (tenant_id, sku, nombre, categoria, descripcion, precio, moneda, stock, garantia_dias, disponible)
select
  (select id from tenants where slug = 'wiltech'),
  i.sku,
  i.tipo_pieza || ' ' || i.dispositivo || ' (' || i.calidad || ')',
  i.tipo_pieza,
  i.descripcion,
  i.precio,
  i.moneda,
  i.stock,
  i.garantia_dias,
  i.activo
from inventario_piezas i
where not exists (
  select 1 from servicios s where s.tenant_id = (select id from tenants where slug = 'wiltech')
);

-- ----------------------------------------------------------------------------
-- 5. google_oauth_tokens: de fila única global a una fila por tenant
-- ----------------------------------------------------------------------------
alter table google_oauth_tokens add column if not exists tenant_id uuid references tenants(id);
update google_oauth_tokens set tenant_id = (select id from tenants where slug = 'wiltech') where tenant_id is null;
create unique index if not exists idx_google_oauth_tokens_tenant on google_oauth_tokens (tenant_id);

-- ----------------------------------------------------------------------------
-- 6. consultas_analiticas: columnas nuevas del template (no borra las viejas)
-- ----------------------------------------------------------------------------
alter table consultas_analiticas add column if not exists servicio_texto text;
alter table consultas_analiticas add column if not exists servicio_id uuid;
update consultas_analiticas set servicio_texto = coalesce(servicio_texto, pieza_texto) where servicio_texto is null;

-- ----------------------------------------------------------------------------
-- 7. Vistas del dashboard (drop + recreate: cambia el set de columnas)
-- ----------------------------------------------------------------------------
drop view if exists v_metricas;
drop view if exists v_piezas_mas_preguntadas;
drop view if exists v_preguntas_frecuentes;
drop view if exists v_consultas_por_categoria;
drop view if exists v_clientes_por_dia;
drop view if exists v_embudo;

create view v_metricas as
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

create view v_servicios_mas_preguntados as
select
  c.tenant_id,
  coalesce(s.nombre, c.servicio_texto, c.pieza_texto, 'Desconocido') as servicio,
  count(*)         as veces_preguntada,
  max(c.creado_en) as ultima_consulta
from consultas_analiticas c
left join servicios s on s.id = c.servicio_id
where c.categoria in ('precio', 'disponibilidad')
group by c.tenant_id, coalesce(s.nombre, c.servicio_texto, c.pieza_texto, 'Desconocido')
order by veces_preguntada desc;

create view v_preguntas_frecuentes as
select tenant_id, categoria, pregunta, count(*) as repeticiones, max(creado_en) as ultima_vez
from consultas_analiticas
group by tenant_id, categoria, pregunta
order by repeticiones desc;

create view v_consultas_por_categoria as
select tenant_id, categoria, count(*) as total
from consultas_analiticas
group by tenant_id, categoria
order by total desc;

create view v_embudo as
select tenant_id, estado, count(*) as total
from clientes
group by tenant_id, estado;

-- ----------------------------------------------------------------------------
-- 8. RLS — CRÍTICO: las políticas viejas dejaban leer TODO con la clave
--    pública "anon". Con más de un cliente en la misma base hay que
--    reemplazarlas por las que respetan tenant_admins.
-- ----------------------------------------------------------------------------
alter table tenants              enable row level security;
alter table tenant_admins        enable row level security;
alter table clientes             enable row level security;
alter table mensajes             enable row level security;
alter table consultas_analiticas enable row level security;
alter table servicios            enable row level security;
alter table citas                enable row level security;
alter table empleados            enable row level security;
alter table google_oauth_tokens  enable row level security;
alter table super_admins         enable row level security;

drop policy if exists dashboard_read_clientes   on clientes;
drop policy if exists dashboard_read_mensajes   on mensajes;
drop policy if exists dashboard_read_consultas  on consultas_analiticas;
drop policy if exists dashboard_read_piezas     on inventario_piezas;
drop policy if exists dashboard_read_citas      on citas;

drop policy if exists tenant_admins_ve_su_tenant on tenants;
drop policy if exists dashboard_read_tenant_admins on tenant_admins;
drop policy if exists dashboard_read_servicios on servicios;
drop policy if exists dashboard_read_empleados on empleados;
drop policy if exists dashboard_write_servicios on servicios;
drop policy if exists dashboard_write_empleados on empleados;

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

create policy dashboard_write_servicios on servicios
  for all to authenticated using (tiene_acceso_tenant(tenant_id)) with check (tiene_acceso_tenant(tenant_id));
create policy dashboard_write_empleados on empleados
  for all to authenticated using (tiene_acceso_tenant(tenant_id)) with check (tiene_acceso_tenant(tenant_id));
