import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type FailureSource = "whatsapp" | "email" | "oauth" | "ai";
export interface OperationFailure {
  id: string;
  tenantSlug: string;
  source: FailureSource;
  operation: string;
  message: string;
  dedupeKey: string;
  status: "pending" | "retrying" | "resolved" | "intervention";
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
}
interface Metric { tenantSlug: string; source: "whatsapp" | "email"; latencyMs: number; tokens: number; at: string }
interface Store { failures: OperationFailure[]; metrics: Metric[] }

const dataDir = process.env.OPERATIONS_DATA_DIR?.trim() || "/data";
const file = path.join(dataDir, "stage-operations.json");
let chain = Promise.resolve();

async function load(): Promise<Store> {
  try {
    const value = JSON.parse(await readFile(file, "utf8"));
    return { failures: Array.isArray(value.failures) ? value.failures : [], metrics: Array.isArray(value.metrics) ? value.metrics : [] };
  } catch (error: any) {
    if (error?.code !== "ENOENT") console.error("[operations] No se pudo leer la cola:", error);
    return { failures: [], metrics: [] };
  }
}

async function mutate<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  let output!: T;
  const operation = chain.then(async () => {
    const store = await load();
    output = await fn(store);
    store.failures = store.failures.slice(-300);
    store.metrics = store.metrics.filter((m) => Date.now() - new Date(m.at).getTime() < 7 * 86400_000).slice(-1000);
    await mkdir(dataDir, { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temp, file);
  });
  chain = operation.catch(() => undefined);
  await operation;
  return output;
}

export async function queueFailure(input: { tenantSlug: string; source: FailureSource; operation: string; error: unknown; dedupeKey?: string; maxAttempts?: number }) {
  const message = input.error instanceof Error ? input.error.message : String(input.error || "Error desconocido");
  const dedupeKey = input.dedupeKey || `${input.tenantSlug}:${input.source}:${input.operation}:${message.slice(0, 100)}`;
  return mutate((store) => {
    const existing = store.failures.find((f) => f.dedupeKey === dedupeKey && f.status !== "resolved");
    if (existing) { existing.updatedAt = new Date().toISOString(); return existing; }
    const now = new Date().toISOString();
    const failure: OperationFailure = { id: randomUUID(), tenantSlug: input.tenantSlug, source: input.source, operation: input.operation, message: message.slice(0, 800), dedupeKey, status: "pending", attempts: 0, maxAttempts: input.maxAttempts ?? 3, createdAt: now, updatedAt: now };
    store.failures.push(failure);
    return failure;
  });
}

export async function recordMetric(metric: Omit<Metric, "at">) {
  await mutate((store) => { store.metrics.push({ ...metric, at: new Date().toISOString() }); });
}

export async function operationStatus(tenantSlug: string) {
  await chain;
  const store = await load();
  const failures = store.failures.filter((f) => f.tenantSlug === tenantSlug).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const metrics = store.metrics.filter((m) => m.tenantSlug === tenantSlug);
  const recent = metrics.filter((m) => Date.now() - new Date(m.at).getTime() < 24 * 3600_000);
  const averageLatencyMs = recent.length ? Math.round(recent.reduce((sum, m) => sum + m.latencyMs, 0) / recent.length) : 0;
  const tokens24h = recent.reduce((sum, m) => sum + m.tokens, 0);
  return {
    failures,
    pendingFailures: failures.filter((f) => f.status !== "resolved").length,
    averageLatencyMs,
    slowResponses: recent.filter((m) => m.latencyMs > 15_000).length,
    tokens24h,
    abnormalCost: tokens24h > Number(process.env.OPERATIONS_TOKEN_ALERT_24H || 500_000),
  };
}

export async function beginRetry(tenantSlug: string, id: string) {
  return mutate((store) => {
    const item = store.failures.find((f) => f.id === id && f.tenantSlug === tenantSlug);
    if (!item) return null;
    if (item.attempts >= item.maxAttempts) { item.status = "intervention"; return item; }
    item.attempts += 1; item.status = "retrying"; item.updatedAt = new Date().toISOString(); return item;
  });
}

export async function finishRetry(tenantSlug: string, id: string, ok: boolean, error?: unknown) {
  return mutate((store) => {
    const item = store.failures.find((f) => f.id === id && f.tenantSlug === tenantSlug);
    if (!item) return null;
    item.status = ok ? "resolved" : item.attempts >= item.maxAttempts ? "intervention" : "pending";
    if (error) item.message = error instanceof Error ? error.message : String(error);
    item.updatedAt = new Date().toISOString(); return item;
  });
}
