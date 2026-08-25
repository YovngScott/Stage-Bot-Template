-- Cuentas Gmail de solo lectura para la automatización exclusiva de Domínguez.
-- El refresh token se cifra con AES-256-GCM antes de almacenarse.
create table if not exists insurance_email_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  email text not null,
  label text not null default 'Correo de seguros',
  encrypted_refresh_token text not null,
  active boolean not null default true,
  last_checked_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create index if not exists idx_insurance_accounts_due
  on insurance_email_accounts (tenant_id, active, last_checked_at);

alter table insurance_email_accounts enable row level security;
-- Deliberadamente sin políticas authenticated/anon: contiene credenciales.
-- Solo el backend con service_role puede leer o modificar estas filas.
