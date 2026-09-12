-- Backend-only: the dashboard accesses these records through tenant-authorized routes.
create table if not exists public.instagram_connections (
 tenant_id uuid primary key references public.tenants(id) on delete cascade,
 account_id text not null unique,
 page_id text,
 backend_origin text not null default '',
 username text not null default '',
 token_ciphertext text not null,
 provider text not null check (provider in ('instagram', 'facebook')),
 enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
create table if not exists public.instagram_rules (
 tenant_id uuid primary key references public.tenants(id) on delete cascade,
 rules jsonb not null default '[]'::jsonb check (jsonb_typeof(rules) = 'array'),
 updated_at timestamptz not null default now()
);
alter table public.instagram_connections enable row level security;
alter table public.instagram_rules enable row level security;
revoke all on public.instagram_connections, public.instagram_rules from public, anon, authenticated;
grant select, insert, update, delete on public.instagram_connections, public.instagram_rules to service_role;
