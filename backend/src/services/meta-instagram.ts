import crypto from "node:crypto";
import { conTimeout } from "../lib/timeout.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta el secreto ${name} para Instagram Messaging.`);
  return value;
}

export function instagramConfigured(): boolean {
  return Boolean(
    process.env.META_INSTAGRAM_ACCESS_TOKEN?.trim() &&
      process.env.META_INSTAGRAM_VERIFY_TOKEN?.trim() &&
      process.env.META_INSTAGRAM_APP_SECRET?.trim() &&
      process.env.META_INSTAGRAM_ACCOUNT_ID?.trim(),
  );
}

/** Responde el challenge que Meta envía al registrar el webhook. */
export function verifyInstagramChallenge(mode: unknown, token: unknown, challenge: unknown): string | null {
  if (mode !== "subscribe" || typeof challenge !== "string" || typeof token !== "string") return null;
  const expected = process.env.META_INSTAGRAM_VERIFY_TOKEN?.trim();
  if (!expected) return null;
  const given = Buffer.from(token);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;
  return challenge;
}

/** Verifica el cuerpo crudo, antes de confiar en un evento recibido. */
export function verifyInstagramSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = process.env.META_INSTAGRAM_APP_SECRET?.trim();
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && crypto.timingSafeEqual(given, wanted);
}

export interface InstagramIncomingMessage {
  id: string;
  senderId: string;
  recipientId: string;
  text: string;
  mediaType: "text" | "image" | "audio" | "video" | "share" | "unknown";
}

/**
 * Normaliza el formato de Instagram Messaging. Ignora ecos del propio bot,
 * recibos de entrega/lectura y eventos sin contenido conversacional.
 */
export function parseInstagramMessages(body: unknown): InstagramIncomingMessage[] {
  const payload = body as { entry?: unknown[]; field?: unknown; value?: unknown } | null;
  const result: InstagramIncomingMessage[] = [];
  const seen = new Set<string>();

  const appendEvent = (event: unknown, fallbackRecipientId = "") => {
    const item = event as { sender?: { id?: unknown }; recipient?: { id?: unknown }; message?: Record<string, unknown>; timestamp?: unknown };
    const message = item?.message;
    if (!message || message.is_echo === true) return;
    const id = String(message.mid ?? "").trim();
    const senderId = String(item.sender?.id ?? "").trim();
    const messageRecipientId = String(item.recipient?.id ?? fallbackRecipientId).trim();
    const attachment = Array.isArray(message.attachments) ? message.attachments[0] as { type?: unknown } | undefined : undefined;
    const rawType = String(attachment?.type ?? "text");
    const mediaType: InstagramIncomingMessage["mediaType"] =
      rawType === "image" || rawType === "audio" || rawType === "video" || rawType === "share" ? rawType : rawType === "text" ? "text" : "unknown";
    const text = String(
      message.text ??
        (mediaType === "image" ? "[Imagen recibida sin descripción]" : undefined) ??
        (mediaType === "audio" ? "[Audio recibido: requiere revisión humana]" : undefined) ??
        (mediaType === "video" ? "[Video recibido: requiere revisión humana]" : undefined) ??
        (mediaType === "share" ? "[Contenido compartido recibido]" : undefined) ??
        "",
    ).trim();
    if (id && senderId && messageRecipientId && text && !seen.has(id)) {
      seen.add(id);
      result.push({ id, senderId, recipientId: messageRecipientId, text, mediaType });
    }
  };

  // El modal de pruebas de Meta entrega directamente { field, value }.
  if (payload?.field === "messages") appendEvent(payload.value);

  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    const typedEntry = entry as { id?: unknown; messaging?: unknown[]; changes?: unknown[] };
    const recipientId = String(typedEntry.id ?? "").trim();
    for (const event of Array.isArray(typedEntry.messaging) ? typedEntry.messaging : []) {
      appendEvent(event, recipientId);
    }
    for (const change of Array.isArray(typedEntry.changes) ? typedEntry.changes : []) {
      const typedChange = change as { field?: unknown; value?: unknown };
      if (typedChange.field === "messages") appendEvent(typedChange.value, recipientId);
    }
  }
  return result;
}

/** Envía una respuesta dentro de la ventana de mensajería autorizada por Meta. */
export async function sendInstagramText(recipientId: string, text: string): Promise<void> {
  const token = required("META_INSTAGRAM_ACCESS_TOKEN");
  const accountId = required("META_INSTAGRAM_ACCOUNT_ID");
  const version = process.env.META_INSTAGRAM_API_VERSION?.trim() || "v26.0";
  const response = await conTimeout(
    fetch(`https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(accountId)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: "RESPONSE", message: { text: text.slice(0, 1000) } }),
    }),
    15_000,
    "meta-instagram-send",
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 800);
    throw new Error(`Meta Instagram rechazó el envío (${response.status}): ${detail}`);
  }
}
