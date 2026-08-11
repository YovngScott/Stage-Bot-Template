import { randomUUID } from "node:crypto";
import { supabase } from "../lib/supabase.js";

export type FailureSource = "whatsapp" | "email" | "oauth" | "ai";
export type FailureStatus = "pending" | "retrying" | "resolved" | "intervention";

export interface OperationFailure {
  id: string;
  tenantSlug: string;
  source: FailureSource;
  operation: string;
  message: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  status: FailureStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

interface FailureRow {
  id: string;
  tenant_slug: string;
  source: FailureSource;
  operation: string;
  message: string;
  dedupe_key: string;
  payload: Record<string, unknown> | null;
  status: FailureStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  locked_at: string | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

function mapFailure(row: FailureRow): OperationFailure {
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    source: row.source,
    operation: row.operation,
    message: row.message,
    dedupeKey: row.dedupe_key,
    payload: row.payload ?? {},
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    nextAttemptAt: row.next_attempt_at,
    lockedAt: row.locked_at,
    lockedBy: row.locked_by,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

export async function queueFailure(input: {
  tenantSlug: string;
  source: FailureSource;
  operation: string;
  error: unknown;
  dedupeKey?: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}) {
  const message = input.error instanceof Error ? input.error.message : String(input.error || "Error desconocido");
  const dedupeKey = input.dedupeKey || `${input.tenantSlug}:${input.source}:${input.operation}:${message.slice(0, 100)}`;
  const { data, error } = await supabase.rpc("queue_operation_failure", {
    p_tenant_slug: input.tenantSlug,
    p_source: input.source,
    p_operation: input.operation,
    p_message: message,
    p_dedupe_key: dedupeKey,
    p_payload: input.payload ?? {},
    p_max_attempts: input.maxAttempts ?? 3,
  });
  if (error) throw new Error(`No se pudo guardar el fallo operacional: ${error.message}`);
  return mapFailure(data as FailureRow);
}

export async function recordMetric(metric: {
  tenantSlug: string;
  source: "whatsapp" | "email";
  latencyMs: number;
  tokens: number;
}) {
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", metric.tenantSlug)
    .single();
  if (tenantError) throw tenantError;
  const { error } = await supabase.from("operation_metrics").insert({
    tenant_id: tenant.id,
    tenant_slug: metric.tenantSlug,
    source: metric.source,
    latency_ms: Math.max(0, Math.round(metric.latencyMs)),
    tokens: Math.max(0, Math.round(metric.tokens)),
  });
  if (error) throw error;
}

export async function operationStatus(tenantSlug: string) {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const [{ data: failures, error: failureError }, { data: metrics, error: metricError }] = await Promise.all([
    supabase
      .from("operation_failures")
      .select("*")
      .eq("tenant_slug", tenantSlug)
      .order("updated_at", { ascending: false })
      .limit(300),
    supabase
      .from("operation_metrics")
      .select("source, latency_ms, tokens, created_at")
      .eq("tenant_slug", tenantSlug)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (failureError) throw failureError;
  if (metricError) throw metricError;

  const mapped = ((failures ?? []) as FailureRow[]).map(mapFailure);
  const recent = metrics ?? [];
  const averageLatencyMs = recent.length
    ? Math.round(recent.reduce((sum, item) => sum + Number(item.latency_ms || 0), 0) / recent.length)
    : 0;
  const tokens24h = recent.reduce((sum, item) => sum + Number(item.tokens || 0), 0);
  return {
    failures: mapped,
    pendingFailures: mapped.filter((failure) => failure.status !== "resolved").length,
    averageLatencyMs,
    slowResponses: recent.filter((item) => Number(item.latency_ms || 0) > 15_000).length,
    tokens24h,
    abnormalCost: tokens24h > Number(process.env.OPERATIONS_TOKEN_ALERT_24H || 500_000),
  };
}

export function createWorkerId(prefix = "stage") {
  return `${prefix}:${process.env.FLY_MACHINE_ID || process.pid}:${randomUUID()}`;
}

export async function claimFailures(workerId: string, tenantSlugs: string[], limit = 10): Promise<OperationFailure[]> {
  if (tenantSlugs.length === 0) return [];
  const { data, error } = await supabase.rpc("claim_operation_failures", {
    p_worker_id: workerId,
    p_tenant_slugs: tenantSlugs,
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (error) throw error;
  return ((data ?? []) as FailureRow[]).map(mapFailure);
}

export async function beginRetry(tenantSlug: string, id: string, workerId: string) {
  const { data, error } = await supabase.rpc("claim_operation_failure", {
    p_id: id,
    p_tenant_slug: tenantSlug,
    p_worker_id: workerId,
    p_lease_seconds: 120,
  });
  if (error) throw error;
  return data ? mapFailure(data as FailureRow) : null;
}

export async function finishRetry(id: string, workerId: string, ok: boolean, error?: unknown) {
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  const { data, error: dbError } = await supabase.rpc("finish_operation_failure", {
    p_id: id,
    p_worker_id: workerId,
    p_ok: ok,
    p_error: message,
  });
  if (dbError) throw dbError;
  return data ? mapFailure(data as FailureRow) : null;
}

export async function markIntervention(tenantSlug: string, id: string, reason: string) {
  const { data, error } = await supabase
    .from("operation_failures")
    .update({
      status: "intervention",
      last_error: reason.slice(0, 800),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? mapFailure(data as FailureRow) : null;
}

export async function requeueFailure(tenantSlug: string, id: string) {
  const { data, error } = await supabase
    .from("operation_failures")
    .update({
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      resolved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug)
    .in("status", ["pending", "intervention"])
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? mapFailure(data as FailureRow) : null;
}

export async function resolveFailure(tenantSlug: string, id: string) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("operation_failures")
    .update({ status: "resolved", resolved_at: now, locked_at: null, locked_by: null, updated_at: now })
    .eq("id", id)
    .eq("tenant_slug", tenantSlug)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ? mapFailure(data as FailureRow) : null;
}
