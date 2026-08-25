import crypto from "node:crypto";
import { google, type gmail_v1 } from "googleapis";
import type { Tenant } from "../lib/tenants.js";
import { config } from "../lib/config.js";
import { cifrar, descifrar, cifradoDisponible } from "../lib/cripto.js";
import { supabase } from "../lib/supabase.js";
import { notificarEmpleados } from "./notificaciones.js";

interface PendingOauth {
  tenantId: string;
  slug: string;
  label: string;
  loginHint: string;
  redirectUri: string;
  expiresAt: number;
}

const pendingOauth = new Map<string, PendingOauth>();
const activePolls = new Set<string>();

function oauthClient(redirectUri: string) {
  if (!config.google.oauthClientId || !config.google.oauthClientSecret) {
    throw new Error("Faltan GOOGLE_OAUTH_CLIENT_ID/SECRET.");
  }
  return new google.auth.OAuth2(config.google.oauthClientId, config.google.oauthClientSecret, redirectUri);
}

export function insuranceRedirectUri(req: { get(name: string): string | undefined; protocol: string }) {
  if (config.google.insuranceRedirectUri) return config.google.insuranceRedirectUri;
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${req.get("host")}/api/insurance/oauth-callback`;
}

export function createInsuranceAuthUrl(tenant: Tenant, label: string, loginHint: string, redirectUri: string) {
  if (!cifradoDisponible()) throw new Error("Falta CREDENCIALES_SECRET; no se guardará OAuth sin cifrar.");
  const state = crypto.randomBytes(32).toString("base64url");
  pendingOauth.set(state, {
    tenantId: tenant.id,
    slug: tenant.config.slug,
    label: label.trim() || "Correo de seguros",
    loginHint: loginHint.trim().toLowerCase(),
    redirectUri,
    expiresAt: Date.now() + 10 * 60_000,
  });
  return oauthClient(redirectUri).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    login_hint: loginHint || undefined,
    scope: ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"],
  });
}

export async function completeInsuranceOauth(state: string, code: string) {
  const pending = pendingOauth.get(state);
  pendingOauth.delete(state);
  if (!pending || pending.expiresAt < Date.now()) throw new Error("Enlace OAuth inválido o vencido.");
  const client = oauthClient(pending.redirectUri);
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) throw new Error("Google no devolvió refresh_token; vuelve a autorizar la cuenta.");
  client.setCredentials(tokens);
  const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({ userId: "me" });
  const email = String(profile.data.emailAddress || "").trim().toLowerCase();
  if (!email) throw new Error("No se pudo identificar la cuenta autorizada.");
  const { error } = await supabase.from("insurance_email_accounts").upsert({
    tenant_id: pending.tenantId,
    email,
    label: pending.label,
    encrypted_refresh_token: cifrar(tokens.refresh_token),
    active: true,
    last_error: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,email" });
  if (error) throw error;
  return { slug: pending.slug, email };
}

export async function listInsuranceAccounts(tenantId: string) {
  const { data, error } = await supabase
    .from("insurance_email_accounts")
    .select("id,email,label,active,last_checked_at,last_error,connected_at")
    .eq("tenant_id", tenantId)
    .order("connected_at");
  if (error) throw error;
  return data ?? [];
}

export async function deleteInsuranceAccount(tenantId: string, id: string) {
  const { error } = await supabase.from("insurance_email_accounts").delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) throw error;
}

function header(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string) {
  return headers?.find((item) => item.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function bodyText(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts ?? []) {
    const text = bodyText(child);
    if (text.trim()) return text;
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  }
  return "";
}

function attachmentParts(part: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!part) return [];
  return [...(part.filename ? [part] : []), ...(part.parts ?? []).flatMap(attachmentParts)];
}

async function integration(action: string, init: RequestInit = {}, query = "") {
  if (!config.insurance.sharedSecret) throw new Error("Falta DOMINGUEZ_INSURANCE_SECRET.");
  const url = `${config.insurance.integrationUrl}?action=${encodeURIComponent(action)}${query}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-stage-insurance-secret": config.insurance.sharedSecret,
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Integración Domínguez respondió ${response.status}`);
  return body;
}

export async function listInsuranceReviews(status?: string) {
  return integration("list", {}, status ? `&status=${encodeURIComponent(status)}` : "");
}

export async function insuranceReviewDetail(id: string) {
  return integration("detail", {}, `&id=${encodeURIComponent(id)}`);
}

export async function resolveInsuranceReview(id: string, action: "approve" | "reject") {
  return integration(action, { method: "POST", body: JSON.stringify({ id }) });
}

async function processAccount(tenant: Tenant, account: any) {
  const redirectUri = config.google.insuranceRedirectUri || config.google.oauthRedirectUri;
  const client = oauthClient(redirectUri);
  client.setCredentials({ refresh_token: descifrar(account.encrypted_refresh_token) });
  const gmail = google.gmail({ version: "v1", auth: client });
  const since = account.last_checked_at
    ? new Date(new Date(account.last_checked_at).getTime() - 2 * 60_000)
    : new Date(Date.now() - 24 * 60 * 60_000);
  const listed = await gmail.users.messages.list({
    userId: "me",
    q: `in:inbox -in:chats after:${Math.floor(since.getTime() / 1000)}`,
    maxResults: 50,
  });
  const ids = (listed.data.messages ?? []).map((item) => item.id).filter(Boolean) as string[];
  for (const id of ids.reverse()) {
    const message = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const payload = message.data.payload;
    const attachments = [];
    for (const part of attachmentParts(payload).slice(0, 8)) {
      const isPdf = /pdf/i.test(part.mimeType || "") || /\.pdf$/i.test(part.filename || "");
      if (!isPdf || !part.body?.attachmentId || Number(part.body.size || 0) > 15 * 1024 * 1024) continue;
      const file = await gmail.users.messages.attachments.get({ userId: "me", messageId: id, id: part.body.attachmentId });
      if (file.data.data) attachments.push({
        name: part.filename || "documento-seguro.pdf",
        mimeType: "application/pdf",
        base64: Buffer.from(file.data.data, "base64url").toString("base64"),
      });
    }
    const result = await integration("ingest", {
      method: "POST",
      body: JSON.stringify({
        messageId: `${account.id}:${id}`,
        accountEmail: account.email,
        sender: header(payload?.headers, "From"),
        subject: header(payload?.headers, "Subject"),
        body: bodyText(payload).slice(0, 12000),
        receivedAt: message.data.internalDate ? new Date(Number(message.data.internalDate)).toISOString() : new Date().toISOString(),
        attachments,
      }),
    });
    if (result.alert && !result.duplicate) await notificarEmpleados(tenant.id, result.alert);
  }
  const { error } = await supabase.from("insurance_email_accounts").update({
    last_checked_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  }).eq("id", account.id);
  if (error) throw error;
  return ids.length;
}

export async function pollInsuranceEmails(tenant: Tenant) {
  if (tenant.config.slug !== "dominguez-auto-pintura") return { accounts: 0, messages: 0 };
  if (activePolls.has(tenant.id)) return { accounts: 0, messages: 0, skipped: true };
  activePolls.add(tenant.id);
  try {
    const { data, error } = await supabase.from("insurance_email_accounts").select("*").eq("tenant_id", tenant.id).eq("active", true);
    if (error) throw error;
    let messages = 0;
    for (const account of data ?? []) {
      try {
        messages += await processAccount(tenant, account);
      } catch (error: any) {
        console.error(`[seguros:${account.email}]`, error);
        await supabase.from("insurance_email_accounts").update({ last_error: String(error?.message || error).slice(0, 800), updated_at: new Date().toISOString() }).eq("id", account.id);
      }
    }
    return { accounts: data?.length ?? 0, messages };
  } finally {
    activePolls.delete(tenant.id);
  }
}
