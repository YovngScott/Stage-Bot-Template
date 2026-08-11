-- Memoria operativa persistente para asistentes de correo.
-- Cada pendiente pertenece a un tenant y a un hilo; nunca vive solo en RAM.

create table if not exists public.email_followups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  thread_id text not null,
  source_message_id text not null,
  recipient text not null,
  subject text not null default '',
  message_id text,
  task_type text not null default 'follow_up'
    check (task_type in ('calendar', 'reply', 'review', 'follow_up')),
  title text not null,
  notes text not null default '',
  due_at timestamptz,
  status text not null default 'pending_owner'
    check (status in ('pending_owner', 'ready_to_reply', 'completed', 'cancelled')),
  context jsonb not null default '[]'::jsonb,
  draft_reply text,
  owner_note text,
  resolution text,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, source_message_id)
);

create index if not exists idx_email_followups_tenant_status
  on public.email_followups (tenant_id, status, updated_at desc);
create index if not exists idx_email_followups_thread
  on public.email_followups (tenant_id, thread_id, updated_at desc);

alter table public.email_followups enable row level security;
drop policy if exists email_followups_service_role on public.email_followups;
create policy email_followups_service_role on public.email_followups
  for all to service_role using (true) with check (true);

