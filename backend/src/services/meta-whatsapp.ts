import crypto from "node:crypto";
import type { Tenant } from "../lib/tenants.js";
import { conTimeout } from "../lib/timeout.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta el secreto ${name} para Meta WhatsApp Cloud API.`);
  return value;
}

export function metaConfigured(tenant: Tenant): boolean {
  return Boolean(
    tenant.config.whatsapp.phoneNumberId &&
      process.env.META_WHATSAPP_ACCESS_TOKEN?.trim() &&
      process.env.META_WHATSAPP_VERIFY_TOKEN?.trim() &&
      process.env.META_WHATSAPP_APP_SECRET?.trim(),
  );
}

export function verifyMetaChallenge(mode: unknown, token: unknown, challenge: unknown): string | null {
  if (mode !== "subscribe" || typeof challenge !== "string") return null;
  const expected = process.env.META_WHATSAPP_VERIFY_TOKEN?.trim();
  if (!expected || typeof token !== "string") return null;
  const given = Buffer.from(token);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;
  return challenge;
}

export function verifyMetaSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = process.env.META_WHATSAPP_APP_SECRET?.trim();
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

export interface MetaIncomingMessage {
  id: string;
  phone: string;
  name?: string;
  text: string;
}

export function parseMetaMessages(body: any): MetaIncomingMessage[] {
  const result: MetaIncomingMessage[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value;
      const names = new Map<string, string>();
      for (const contact of Array.isArray(value?.contacts) ? value.contacts : []) {
        if (contact?.wa_id) names.set(String(contact.wa_id), String(contact?.profile?.name ?? "").trim());
      }
      for (const message of Array.isArray(value?.messages) ? value.messages : []) {
        const phone = String(message?.from ?? "").replace(/\D/g, "");
        const id = String(message?.id ?? "").trim();
        const text = String(
          message?.text?.body ??
            message?.image?.caption ??
            message?.document?.caption ??
            message?.button?.text ??
            message?.interactive?.button_reply?.title ??
            message?.interactive?.list_reply?.title ??
            "",
        ).trim();
        if (phone && id && text) result.push({ id, phone: `+${phone}`, name: names.get(phone), text });
      }
    }
  }
  return result;
}

export async function sendMetaText(tenant: Tenant, phone: string, text: string): Promise<void> {
  const token = required("META_WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = tenant.config.whatsapp.phoneNumberId || required("META_WHATSAPP_PHONE_NUMBER_ID");
  const version = tenant.config.whatsapp.apiVersion || process.env.META_WHATSAPP_API_VERSION?.trim() || "v23.0";
  const response = await conTimeout(
    fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: phone.replace(/\D/g, ""),
        type: "text",
        text: { preview_url: false, body: text },
      }),
    }),
    15_000,
    "meta-whatsapp-send",
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    throw new Error(`Meta WhatsApp rechazó el envío (${response.status}): ${detail}`);
  }
}
