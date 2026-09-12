revoke execute on function public.record_tenant_usage(uuid,text,bigint,bigint,bigint,bigint,numeric) from public, anon, authenticated;
grant execute on function public.record_tenant_usage(uuid,text,bigint,bigint,bigint,bigint,numeric) to service_role;
alter function public.record_tenant_usage(uuid,text,bigint,bigint,bigint,bigint,numeric) set search_path = public, pg_temp;
