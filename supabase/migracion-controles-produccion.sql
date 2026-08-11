-- Controles operativos de producción. Idempotente y multi-tenant.
create extension if not exists "pgcrypto";

create table if not exists tenant_runtime_policies (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  mode text not null default 'shadow' check (mode in ('shadow','limited','live','paused')),
  auto_send_percentage integer not null default 0 check (auto_send_percentage between 0 and 100),
  monthly_messages integer not null default 5000 check (monthly_messages > 0),
  monthly_emails integer not null default 2000 check (monthly_emails > 0),
  monthly_tokens bigint not null default 10000000 check (monthly_tokens > 0),
  monthly_cost_usd numeric(12,2) not null default 50 check (monthly_cost_usd > 0),
  warning_percentage integer not null default 80 check (warning_percentage between 1 and 100),
  country_code text not null default 'DO',
  require_consent boolean not null default true,
  retention_days integer not null default 90 check (retention_days between 1 and 3650),
  spam_per_minute integer not null default 12 check (spam_per_minute between 1 and 1000),
  paused_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists conversation_controls (
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  conversation_id text not null,
  state text not null default 'bot' check (state in ('bot','human')),
  taken_by text,
  reason text,
  taken_at timestamptz,
  returned_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, channel, conversation_id)
);

create table if not exists channel_consents (
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  contact text not null,
  status text not null check (status in ('opted_in','opted_out','unknown')),
  source text not null default 'conversation',
  evidence text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, channel, contact)
);

create table if not exists usage_ledger (
  tenant_id uuid not null references tenants(id) on delete cascade,
  month date not null,
  channel text not null check (channel in ('whatsapp','email')),
  messages bigint not null default 0,
  emails bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  estimated_cost_usd numeric(14,6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, month, channel)
);

create table if not exists shadow_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  conversation_id text not null,
  incoming_id text not null,
  proposed_response text not null,
  decision text not null,
  model text,
  reviewed boolean not null default false,
  correct_response text,
  created_at timestamptz not null default now(),
  unique (tenant_id, channel, incoming_id)
);

create table if not exists channel_test_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  status text not null default 'pending' check (status in ('pending','waiting_reply','passed','failed')),
  challenge text not null,
  destination text,
  results jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists channel_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  external_id text not null,
  event_type text not null,
  media_type text,
  status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (tenant_id, channel, external_id, event_type)
);

create index if not exists idx_controls_human on conversation_controls(tenant_id, channel, state);
create index if not exists idx_shadow_pending on shadow_decisions(tenant_id, reviewed, created_at desc);
create index if not exists idx_channel_events_recent on channel_events(tenant_id, channel, created_at desc);

create or replace function record_tenant_usage(
  p_tenant_id uuid, p_channel text, p_messages bigint default 0,
  p_emails bigint default 0, p_input_tokens bigint default 0,
  p_output_tokens bigint default 0, p_cost numeric default 0
) returns usage_ledger language plpgsql security definer as $$
declare result usage_ledger;
begin
  insert into usage_ledger(tenant_id, month, channel, messages, emails, input_tokens, output_tokens, estimated_cost_usd)
  values(p_tenant_id, date_trunc('month', now())::date, p_channel, p_messages, p_emails, p_input_tokens, p_output_tokens, p_cost)
  on conflict(tenant_id, month, channel) do update set
    messages = usage_ledger.messages + excluded.messages,
    emails = usage_ledger.emails + excluded.emails,
    input_tokens = usage_ledger.input_tokens + excluded.input_tokens,
    output_tokens = usage_ledger.output_tokens + excluded.output_tokens,
    estimated_cost_usd = usage_ledger.estimated_cost_usd + excluded.estimated_cost_usd,
    updated_at = now()
  returning * into result;
  return result;
end $$;

alter table tenant_runtime_policies enable row level security;
alter table conversation_controls enable row level security;
alter table channel_consents enable row level security;
alter table usage_ledger enable row level security;
alter table shadow_decisions enable row level security;
alter table channel_test_runs enable row level security;
alter table channel_events enable row level security;

do $$ begin
  create policy runtime_read on tenant_runtime_policies for select using (tiene_acceso_tenant(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy controls_all on conversation_controls for all using (tiene_acceso_tenant(tenant_id)) with check (tiene_acceso_tenant(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy consent_all on channel_consents for all using (tiene_acceso_tenant(tenant_id)) with check (tiene_acceso_tenant(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy usage_read on usage_ledger for select using (tiene_acceso_tenant(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy shadow_all on shadow_decisions for all using (tiene_acceso_tenant(tenant_id)) with check (tiene_acceso_tenant(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy tests_all on channel_test_runs for all using (tiene_acceso_tenant(tenant_id)) with check (tiene_acceso_tenant(tenant_id));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy events_read on channel_events for select using (tiene_acceso_tenant(tenant_id));
exception when duplicate_object then null; end $$;
