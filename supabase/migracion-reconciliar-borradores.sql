-- ============================================================================
-- MIGRACIÓN — Reconciliación de borradores
--
-- El titular resuelve los borradores en SU cliente de correo (envía uno,
-- descarta otro) y el dashboard nunca se enteraba: seguían apareciendo como
-- pendientes para siempre. El triaje ahora consulta el buzón y marca lo que
-- ya se resolvió.
--
-- Cómo: Supabase → SQL Editor → pega esto → Run.
-- Es idempotente. Ya está incluida en schema.sql; esto es solo el delta.
-- ============================================================================

-- resuelto_en: cuándo dejó de estar pendiente. NULL = sigue esperando.
-- resolucion:  cómo se resolvió ('enviada', 'descartada' o 'resuelta' cuando
--              el proveedor no permite distinguir — Gmail e IMAP borran el
--              borrador igual al enviarlo que al descartarlo).
alter table asistente_correos add column if not exists resuelto_en timestamptz;
alter table asistente_correos add column if not exists resolucion text;

-- La consulta caliente del dashboard es "qué me falta por revisar".
create index if not exists idx_asistente_correos_pendientes
  on asistente_correos (tenant_id, procesado_en desc)
  where resuelto_en is null;


-- ----------------------------------------------------------------------------
-- VERIFICACIÓN — deben salir 2 filas con ok = 1
-- ----------------------------------------------------------------------------
select 'columna resuelto_en' as verifica, count(*)::text as ok
  from information_schema.columns
 where table_name = 'asistente_correos' and column_name = 'resuelto_en'
union all
select 'columna resolucion', count(*)::text
  from information_schema.columns
 where table_name = 'asistente_correos' and column_name = 'resolucion';
