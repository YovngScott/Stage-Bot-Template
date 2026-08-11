import crypto from "node:crypto";
import { supabase } from "../lib/supabase.js";

export type Channel = "whatsapp" | "email";
export type RuntimeMode = "shadow" | "limited" | "live" | "paused";

export interface RuntimePolicy {
  mode: RuntimeMode;
  autoSendPercentage: number;
  monthlyMessages: number;
  monthlyEmails: number;
  monthlyTokens: number;
  monthlyCostUsd: number;
  warningPercentage: number;
  countryCode: string;
  requireConsent: boolean;
  retentionDays: number;
  spamPerMinute: number;
  pausedReason: string | null;
}

const safeDefault: RuntimePolicy = {
  mode: "shadow",
  autoSendPercentage: 0,
  monthlyMessages: 5000,
  monthlyEmails: 2000,
  monthlyTokens: 10_000_000,
  monthlyCostUsd: 50,
  warningPercentage: 80,
  countryCode: "DO",
  requireConsent: true,
  retentionDays: 90,
  spamPerMinute: 12,
  pausedReason: null,
};

function mapPolicy(row: any): RuntimePolicy {
  return {
    mode: ["shadow", "limited", "live", "paused"].includes(row?.mode) ? row.mode : "shadow",
    autoSendPercentage: Number(row?.auto_send_percentage ?? 0),
    monthlyMessages: Number(row?.monthly_messages ?? 5000),
    monthlyEmails: Number(row?.monthly_emails ?? 2000),
    monthlyTokens: Number(row?.monthly_tokens ?? 10_000_000),
    monthlyCostUsd: Number(row?.monthly_cost_usd ?? 50),
    warningPercentage: Number(row?.warning_percentage ?? 80),
    countryCode: String(row?.country_code ?? "DO"),
    requireConsent: row?.require_consent !== false,
    retentionDays: Number(row?.retention_days ?? 90),
    spamPerMinute: Number(row?.spam_per_minute ?? 12),
    pausedReason: row?.paused_reason ? String(row.paused_reason) : null,
  };
}

export async function getRuntimePolicy(tenantId: string): Promise<RuntimePolicy> {
  const { data, error } = await supabase.from("tenant_runtime_policies").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    console.error("[runtime] No se pudo leer la política; se activa modo sombra:", error.message);
    return safeDefault;
  }
  if (data) return mapPolicy(data);
  const { data: created, error: insertError } = await supabase
    .from("tenant_runtime_policies")
    .insert({ tenant_id: tenantId })
    .select("*")
    .single();
  if (insertError) return safeDefault;
  return mapPolicy(created);
}

export async function setRuntimePolicy(tenantId: string, input: Partial<RuntimePolicy>): Promise<RuntimePolicy> {
  const patch: Record<string, unknown> = { tenant_id: tenantId, updated_at: new Date().toISOString() };
  if (input.mode) patch.mode = input.mode;
  if (input.autoSendPercentage !== undefined) patch.auto_send_percentage = Math.max(0, Math.min(100, input.autoSendPercentage));
  if (input.monthlyMessages !== undefined) patch.monthly_messages = Math.max(1, input.monthlyMessages);
  if (input.monthlyEmails !== undefined) patch.monthly_emails = Math.max(1, input.monthlyEmails);
  if (input.monthlyTokens !== undefined) patch.monthly_tokens = Math.max(1, input.monthlyTokens);
  if (input.monthlyCostUsd !== undefined) patch.monthly_cost_usd = Math.max(0.01, input.monthlyCostUsd);
  if (input.warningPercentage !== undefined) patch.warning_percentage = Math.max(1, Math.min(100, input.warningPercentage));
  if (input.countryCode) patch.country_code = input.countryCode.toUpperCase().slice(0, 2);
  if (input.requireConsent !== undefined) patch.require_consent = input.requireConsent;
  if (input.retentionDays !== undefined) patch.retention_days = Math.max(1, Math.min(3650, input.retentionDays));
  if (input.spamPerMinute !== undefined) patch.spam_per_minute = Math.max(1, Math.min(1000, input.spamPerMinute));
  if (input.pausedReason !== undefined) patch.paused_reason = input.pausedReason;
  const { data, error } = await supabase.from("tenant_runtime_policies").upsert(patch).select("*").single();
  if (error) throw error;
  return mapPolicy(data);
}

export async function setConversationHuman(
  tenantId: string,
  channel: Channel,
  conversationId: string,
  human: boolean,
  details: { takenBy?: string; reason?: string } = {},
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase.from("conversation_controls").upsert({
    tenant_id: tenantId,
    channel,
    conversation_id: conversationId,
    state: human ? "human" : "bot",
    taken_by: human ? details.takenBy || "owner" : null,
    reason: details.reason || null,
    taken_at: human ? now : null,
    returned_at: human ? null : now,
    updated_at: now,
  });
  if (error) throw error;
}

export async function isConversationHuman(tenantId: string, channel: Channel, conversationId: string): Promise<boolean> {
  const { data, error } = await supabase.from("conversation_controls").select("state").eq("tenant_id", tenantId).eq("channel", channel).eq("conversation_id", conversationId).maybeSingle();
  if (error) return true; // fail closed
  return data?.state === "human";
}

const OPT_OUT = /^(stop|cancelar|salir|baja|no me escriban|no contactar|unsubscribe)$/i;
const OPT_IN = /^(start|iniciar|acepto|suscribir|reanudar)$/i;

export function consentCommand(text: string): "opted_out" | "opted_in" | null {
  const normalized = text.trim().replace(/[.!]+$/g, "").trim();
  if (OPT_OUT.test(normalized)) return "opted_out";
  if (OPT_IN.test(normalized)) return "opted_in";
  return null;
}

export async function setConsent(tenantId: string, channel: Channel, contact: string, status: "opted_in" | "opted_out", evidence?: string): Promise<void> {
  const { error } = await supabase.from("channel_consents").upsert({
    tenant_id: tenantId, channel, contact: contact.toLowerCase(), status,
    evidence: evidence?.slice(0, 300) || null, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function isOptedOut(tenantId: string, channel: Channel, contact: string): Promise<boolean> {
  const { data, error } = await supabase.from("channel_consents").select("status").eq("tenant_id", tenantId).eq("channel", channel).eq("contact", contact.toLowerCase()).maybeSingle();
  if (error) return true;
  return data?.status === "opted_out";
}

export interface UsageDecision { allowed: boolean; reason: string | null; warning: boolean; policy: RuntimePolicy }

export async function checkUsage(tenantId: string, channel: Channel): Promise<UsageDecision> {
  const policy = await getRuntimePolicy(tenantId);
  if (policy.mode === "paused") return { allowed: false, reason: policy.pausedReason || "Bot pausado", warning: true, policy };
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const { data, error } = await supabase.from("usage_ledger").select("messages,emails,input_tokens,output_tokens,estimated_cost_usd").eq("tenant_id", tenantId).eq("month", month).eq("channel", channel).maybeSingle();
  if (error) return { allowed: false, reason: "No se pudo verificar el consumo", warning: true, policy };
  const messages = Number(data?.messages ?? 0);
  const emails = Number(data?.emails ?? 0);
  const tokens = Number(data?.input_tokens ?? 0) + Number(data?.output_tokens ?? 0);
  const cost = Number(data?.estimated_cost_usd ?? 0);
  const ratios = [messages / policy.monthlyMessages, emails / policy.monthlyEmails, tokens / policy.monthlyTokens, cost / policy.monthlyCostUsd];
  const ratio = Math.max(...ratios);
  return { allowed: ratio < 1, reason: ratio >= 1 ? "Límite mensual alcanzado" : null, warning: ratio * 100 >= policy.warningPercentage, policy };
}

export async function isSpamBurst(tenantId: string, channel: Channel, contact: string, limit: number): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await supabase
    .from("channel_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("channel", channel)
    .eq("event_type", "inbound")
    .eq("metadata->>contact", contact)
    .gte("created_at", since);
  if (error) return true;
  return Number(count ?? 0) >= limit;
}

export async function recordUsage(tenantId: string, channel: Channel, usage: { messages?: number; emails?: number; inputTokens?: number; outputTokens?: number; costUsd?: number }): Promise<void> {
  const { error } = await supabase.rpc("record_tenant_usage", {
    p_tenant_id: tenantId, p_channel: channel, p_messages: usage.messages ?? 0,
    p_emails: usage.emails ?? 0, p_input_tokens: usage.inputTokens ?? 0,
    p_output_tokens: usage.outputTokens ?? 0, p_cost: usage.costUsd ?? 0,
  });
  if (error) throw error;
}

export function shouldAutoSend(policy: RuntimePolicy, stableId: string): boolean {
  if (policy.mode === "live") return true;
  if (policy.mode !== "limited" || policy.autoSendPercentage <= 0) return false;
  const bucket = crypto.createHash("sha256").update(stableId).digest().readUInt32BE(0) % 100;
  return bucket < policy.autoSendPercentage;
}

export async function saveShadowDecision(input: { tenantId: string; channel: Channel; conversationId: string; incomingId: string; proposedResponse: string; decision: string; model?: string }): Promise<void> {
  const { error } = await supabase.from("shadow_decisions").upsert({
    tenant_id: input.tenantId, channel: input.channel, conversation_id: input.conversationId,
    incoming_id: input.incomingId, proposed_response: input.proposedResponse,
    decision: input.decision, model: input.model || null,
  }, { onConflict: "tenant_id,channel,incoming_id" });
  if (error) throw error;
}

export async function recordChannelEvent(input: { tenantId: string; channel: Channel; externalId: string; eventType: string; mediaType?: string; status?: string; metadata?: Record<string, unknown> }): Promise<void> {
  const { error } = await supabase.from("channel_events").upsert({
    tenant_id: input.tenantId, channel: input.channel, external_id: input.externalId,
    event_type: input.eventType, media_type: input.mediaType || null,
    status: input.status || null, metadata: input.metadata || {},
  }, { onConflict: "tenant_id,channel,external_id,event_type", ignoreDuplicates: true });
  if (error) throw error;
}

export async function createChannelTest(tenantId: string, channel: Channel, destination: string) {
  const challenge = `STAGE-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
  const { data, error } = await supabase.from("channel_test_runs").insert({
    tenant_id: tenantId, channel, destination, challenge, status: "waiting_reply",
    results: { outbound: false, inbound: false, classification: false, response: false },
  }).select("*").single();
  if (error) throw error;
  return data;
}

export async function updateChannelTest(id: string, tenantId: string, patch: { status?: string; results?: Record<string, unknown>; error?: string | null }) {
  const payload: Record<string, unknown> = { ...patch };
  if (patch.status === "passed" || patch.status === "failed") payload.completed_at = new Date().toISOString();
  const { data, error } = await supabase.from("channel_test_runs").update(payload).eq("id", id).eq("tenant_id", tenantId).select("*").single();
  if (error) throw error;
  return data;
}

export async function matchInboundChannelTest(tenantId: string, channel: Channel, text: string): Promise<string | null> {
  const { data, error } = await supabase.from("channel_test_runs").select("id,challenge,results").eq("tenant_id", tenantId).eq("channel", channel).eq("status", "waiting_reply").order("started_at", { ascending: false }).limit(10);
  if (error) return null;
  const match = (data ?? []).find((row: any) => text.includes(String(row.challenge)));
  if (!match) return null;
  await updateChannelTest(match.id, tenantId, {
    results: { ...(match.results ?? {}), outbound: true, inbound: true },
  });
  return match.id;
}

export async function completeChannelTestResponse(id: string, tenantId: string, ok: boolean, detail?: string) {
  const { data } = await supabase.from("channel_test_runs").select("results").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  await updateChannelTest(id, tenantId, {
    status: ok ? "passed" : "failed",
    results: { ...(data?.results ?? {}), classification: ok, response: ok },
    error: ok ? null : detail || "No se pudo enviar la respuesta real",
  });
}
