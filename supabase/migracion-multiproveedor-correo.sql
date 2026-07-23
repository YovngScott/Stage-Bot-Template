-- ============================================================================
-- MIGRACIÓN — Correo multiproveedor (Gmail, Microsoft, IMAP/SMTP)
--
-- CÓRRELA ANTES de desplegar el backend multiproveedor. Sin la tabla nueva,
-- conectar una cuenta de Microsoft o IMAP falla.
--
-- Cómo: Supabase → SQL Editor → pega esto → Run.
-- Es idempotente: puedes correrla las veces que haga falta.
-- Ya está incluida en schema.sql; este archivo es solo el delta.
--
-- Google NO cambia: sigue usando `google_oauth_tokens`, que comparte con
-- Calendar. Las cuentas de Gmail ya conectadas siguen funcionando igual y no
-- tienen que volver a autorizar nada.
-- ============================================================================

-- Cuenta de correo del asistente, una por tenant.
--
-- ⚠️ `credenciales` se guarda CIFRADO por el backend (AES-256-GCM): aquí nunca
-- hay una contraseña de IMAP legible. Requiere la variable de entorno
-- CREDENCIALES_SECRET en el backend; sin ella, conectar un correo por IMAP
-- falla a propósito en vez de guardar la contraseña en claro.
create table if not exists asistente_cuentas (
  tenant_id      uuid primary key references tenants (id) on delete cascade,
  proveedor      text not null check (proveedor in ('gmail','microsoft','imap')),
  cuenta_email   text,
  credenciales   text,
  actualizado_en timestamptz not null default now()
);

-- RLS activa y SIN políticas, igual que super_admins: nadie con la
-- anon/authenticated key puede leerla ni escribirla. Solo el backend, que usa
-- la service_role key. El dashboard del cliente no tiene por qué ver esto.
alter table asistente_cuentas enable row level security;


-- ----------------------------------------------------------------------------
-- VERIFICACIÓN — deben salir 2 filas con ok = 1
-- ----------------------------------------------------------------------------
select 'tabla asistente_cuentas' as verifica,
       count(*)::text as ok
  from information_schema.tables
 where table_name = 'asistente_cuentas'
union all
select 'RLS activa (sin políticas)', count(*)::text
  from pg_tables
 where tablename = 'asistente_cuentas' and rowsecurity = true;
