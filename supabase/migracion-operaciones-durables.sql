-- Cola de operaciones compartida y segura para múltiples workers.
-- Ejecutar una vez en el proyecto Supabase compartido por los bots.

create table if not exists operation_failures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  tenant_slug text not null,
  source text not null check (source in ('whatsapp', 'email', 'oauth', 'ai')),
  operation text not null,
  message text not null,
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'retrying', 'resolved', 'intervention')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 20),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create unique index if not exists operation_failures_open_dedupe
  on operation_failures (tenant_id, dedupe_key)
  where status <> 'resolved';
create index if not exists operation_failures_claimable
  on operation_failures (next_attempt_at, created_at)
  where status = 'pending';
create index if not exists operation_failures_tenant_history
  on operation_failures (tenant_id, updated_at desc);

create table if not exists operation_metrics (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  tenant_slug text not null,
  source text not null check (source in ('whatsapp', 'email')),
  latency_ms integer not null default 0 check (latency_ms >= 0),
  tokens integer not null default 0 check (tokens >= 0),
  created_at timestamptz not null default now()
);

create index if not exists operation_metrics_tenant_created
  on operation_metrics (tenant_id, created_at desc);

create table if not exists scheduled_job_runs (
  tenant_id uuid not null references tenants(id) on delete cascade,
  job text not null,
  local_date date not null,
  claimed_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  primary key (tenant_id, job, local_date)
);

create or replace function claim_scheduled_job(
  p_tenant_id uuid,
  p_job text,
  p_local_date date
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into scheduled_job_runs (tenant_id, job, local_date)
  values (p_tenant_id, p_job, p_local_date)
  on conflict (tenant_id, job, local_date) do update
    set claimed_at = now(), error = null
    where scheduled_job_runs.completed_at is null
      and scheduled_job_runs.error is not null
      and scheduled_job_runs.claimed_at < now() - interval '10 minutes';
  return found;
end;
$$;

create or replace function queue_operation_failure(
  p_tenant_slug text,
  p_source text,
  p_operation text,
  p_message text,
  p_dedupe_key text,
  p_payload jsonb default '{}'::jsonb,
  p_max_attempts integer default 3
) returns operation_failures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid;
  v_row operation_failures;
begin
  select id into v_tenant_id from tenants where slug = p_tenant_slug;
  if v_tenant_id is null then
    raise exception 'Tenant % no existe', p_tenant_slug;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text || ':' || p_dedupe_key, 0));

  select * into v_row
  from operation_failures
  where tenant_id = v_tenant_id and dedupe_key = p_dedupe_key and status <> 'resolved'
  order by created_at desc
  limit 1
  for update;

  if found then
    update operation_failures
    set message = left(p_message, 800),
        payload = coalesce(p_payload, '{}'::jsonb),
        updated_at = now()
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into operation_failures (
    tenant_id, tenant_slug, source, operation, message, dedupe_key, payload, max_attempts
  ) values (
    v_tenant_id, p_tenant_slug, p_source, p_operation, left(p_message, 800),
    p_dedupe_key, coalesce(p_payload, '{}'::jsonb), greatest(1, least(p_max_attempts, 20))
  ) returning * into v_row;
  return v_row;
end;
$$;

drop function if exists claim_operation_failures(text,integer,integer);
create or replace function claim_operation_failures(
  p_worker_id text,
  p_tenant_slugs text[],
  p_limit integer default 10,
  p_lease_seconds integer default 120
) returns setof operation_failures
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Recupera leases abandonados por una máquina que murió durante el trabajo.
  update operation_failures
  set status = 'pending', locked_at = null, locked_by = null, updated_at = now()
  where status = 'retrying'
    and locked_at < now() - make_interval(secs => greatest(30, p_lease_seconds));

  return query
  with candidates as (
    select id
    from operation_failures
    where status = 'pending'
      and tenant_slug = any(p_tenant_slugs)
      and next_attempt_at <= now()
      and attempts < max_attempts
    order by next_attempt_at, created_at
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  )
  update operation_failures f
  set status = 'retrying',
      attempts = f.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      updated_at = now()
  from candidates c
  where f.id = c.id
  returning f.*;
end;
$$;

create or replace function claim_operation_failure(
  p_id uuid,
  p_tenant_slug text,
  p_worker_id text,
  p_lease_seconds integer default 120
) returns operation_failures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row operation_failures;
begin
  update operation_failures
  set status = 'pending', locked_at = null, locked_by = null, updated_at = now()
  where id = p_id and tenant_slug = p_tenant_slug and status = 'retrying'
    and locked_at < now() - make_interval(secs => greatest(30, p_lease_seconds));

  update operation_failures
  set status = 'retrying', attempts = attempts + 1, locked_at = now(),
      locked_by = p_worker_id, updated_at = now()
  where id = p_id and tenant_slug = p_tenant_slug and status = 'pending'
    and attempts < max_attempts and next_attempt_at <= now()
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function finish_operation_failure(
  p_id uuid,
  p_worker_id text,
  p_ok boolean,
  p_error text default null
) returns operation_failures
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row operation_failures;
  v_delay_seconds integer;
begin
  select * into v_row from operation_failures where id = p_id for update;
  if not found then return null; end if;
  if v_row.locked_by is distinct from p_worker_id then
    raise exception 'La operación % pertenece a otro worker', p_id;
  end if;

  if p_ok then
    update operation_failures
    set status = 'resolved', resolved_at = now(), last_error = null,
        locked_at = null, locked_by = null, updated_at = now()
    where id = p_id returning * into v_row;
  else
    v_delay_seconds := least(3600, (power(2, greatest(v_row.attempts - 1, 0)) * 30)::integer);
    update operation_failures
    set status = case when attempts >= max_attempts then 'intervention' else 'pending' end,
        next_attempt_at = now() + make_interval(secs => v_delay_seconds),
        last_error = left(coalesce(p_error, message), 800),
        locked_at = null, locked_by = null, updated_at = now()
    where id = p_id returning * into v_row;
  end if;
  return v_row;
end;
$$;

alter table operation_failures enable row level security;
alter table operation_metrics enable row level security;
alter table scheduled_job_runs enable row level security;

drop policy if exists dashboard_read_operation_failures on operation_failures;
create policy dashboard_read_operation_failures on operation_failures
  for select to authenticated using (tiene_acceso_tenant(tenant_id));

drop policy if exists dashboard_read_operation_metrics on operation_metrics;
create policy dashboard_read_operation_metrics on operation_metrics
  for select to authenticated using (tiene_acceso_tenant(tenant_id));

drop policy if exists dashboard_read_scheduled_job_runs on scheduled_job_runs;
create policy dashboard_read_scheduled_job_runs on scheduled_job_runs
  for select to authenticated using (tiene_acceso_tenant(tenant_id));

revoke all on function queue_operation_failure(text,text,text,text,text,jsonb,integer) from public, anon, authenticated;
revoke all on function claim_operation_failures(text,text[],integer,integer) from public, anon, authenticated;
revoke all on function claim_operation_failure(uuid,text,text,integer) from public, anon, authenticated;
revoke all on function finish_operation_failure(uuid,text,boolean,text) from public, anon, authenticated;
revoke all on function claim_scheduled_job(uuid,text,date) from public, anon, authenticated;
