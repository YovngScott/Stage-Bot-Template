-- ============================================================================
-- MIGRACIÓN — Envío automático del asistente
--
-- CÓRRELA ANTES de desplegar el backend con envío automático. El backend
-- empieza a escribir resultado = 'enviado', que la restricción actual RECHAZA:
-- sin esta migración, cada correo que el asistente responda fallará al
-- registrarse en la base.
--
-- Cómo: Supabase → SQL Editor → pega esto → Run.
-- Es idempotente: puedes correrla las veces que haga falta.
-- Ya está incluida en schema.sql; este archivo es solo el delta.
-- ============================================================================

-- Nuevos significados de `resultado`:
--   'enviado'  → rutinario: el asistente respondió y ENVIÓ el correo solo.
--   'revision' → crítico o ambiguo: dejó BORRADOR y avisó al titular.
--   'omitido'  → descartado por la heurística (no-reply, boletines, masivo).
--   'error'    → la IA falló; se trata como revisión humana.
--   'auto'     → legado: borradores creados antes del envío automático.
do $$
begin
  alter table asistente_correos drop constraint if exists asistente_correos_resultado_check;
  alter table asistente_correos add constraint asistente_correos_resultado_check
    check (resultado in ('enviado','auto','revision','omitido','error'));
end $$;

-- Contador de correos enviados solos en cada corrida.
alter table asistente_ejecuciones add column if not exists enviados integer not null default 0;


-- ----------------------------------------------------------------------------
-- VERIFICACIÓN — deben salir 2 filas con ok = 1
-- ----------------------------------------------------------------------------
select 'acepta el estado enviado' as verifica,
       count(*)::text as ok
  from information_schema.check_constraints
 where constraint_name = 'asistente_correos_resultado_check'
   and check_clause like '%enviado%'
union all
select 'columna enviados en ejecuciones', count(*)::text
  from information_schema.columns
 where table_name = 'asistente_ejecuciones' and column_name = 'enviados';
