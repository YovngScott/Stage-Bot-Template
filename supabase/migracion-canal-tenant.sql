-- ============================================================================
-- MIGRACIÓN — Canal del tenant (qué panel muestra el dashboard del cliente)
--
-- El dashboard del cliente decide qué mostrar leyendo `tenants.canal`
-- directamente de Supabase. Sin esta columna, TODOS los clientes ven el panel
-- de ventas, incluidos los bots asistente.
--
-- Cómo: Supabase → SQL Editor → pega esto → Run.
-- Es idempotente: puedes correrla las veces que haga falta.
-- Ya está incluida en schema.sql; este archivo es solo el delta.
--
-- Tras correrla, reinicia el backend de cada cliente: al arrancar sincroniza
-- el canal a partir del `kind` de su tenant.json.
-- ============================================================================

alter table tenants add column if not exists canal text not null default 'mensajes';

-- Se agrega aparte del ADD COLUMN para poder re-correr el script aunque la
-- columna ya existiera sin restricción.
do $$
begin
  alter table tenants drop constraint if exists tenants_canal_check;
  alter table tenants add constraint tenants_canal_check
    check (canal in ('mensajes','llamadas','asistente'));
end $$;


-- ----------------------------------------------------------------------------
-- VERIFICACIÓN — muestra en qué canal quedó cada cliente
-- ----------------------------------------------------------------------------
select slug, nombre, canal from tenants order by slug;
