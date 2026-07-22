import { google, type gmail_v1 } from "googleapis";
import { obtenerClienteOAuth } from "../calendar.js";
import type { EncabezadosCorreo } from "./heuristica.js";

/**
 * Acceso a Gmail para el módulo de asistente virtual. Reutiliza la MISMA
 * conexión OAuth por tenant que ya usa Google Calendar (tabla
 * google_oauth_tokens): el ejecutivo autoriza una sola vez desde el dashboard.
 *
 * Ingesta por consultas programadas por lotes (list + get) en vez de webhooks:
 * evita depender de Pub/Sub y mantiene el consumo de cuota predecible.
 */

/** Etiqueta que el asistente crea en la bandeja para marcar lo que ya procesó. */
export const ETIQUETA_BASE = "Asistente Stage";

export interface CorreoGmail {
  id: string;
  threadId: string;
  encabezados: EncabezadosCorreo;
  /** Texto plano del cuerpo, recortado. Se usa para clasificar y NUNCA se persiste. */
  cuerpo: string;
  recibidoEn: string;
}

export async function obtenerClienteGmail(tenantId: string): Promise<gmail_v1.Gmail | null> {
  const auth = await obtenerClienteOAuth(tenantId);
  if (!auth) return null;
  return google.gmail({ version: "v1", auth });
}

/**
 * Retroceso exponencial truncado con fluctuación (jitter), como exige el
 * diseño: ante 429/5xx de Gmail reintenta espaciando, en vez de insistir y
 * arriesgar la suspensión del servicio.
 */
async function conReintentos<T>(operacion: () => Promise<T>, intentos = 5): Promise<T> {
  let ultimoError: unknown;
  for (let intento = 0; intento < intentos; intento += 1) {
    try {
      return await operacion();
    } catch (err: any) {
      ultimoError = err;
      const codigo = err?.code ?? err?.response?.status;
      const recuperable = codigo === 429 || codigo === 403 || (codigo >= 500 && codigo < 600);
      if (!recuperable || intento === intentos - 1) throw err;

      const espera = Math.min(2 ** intento * 1000, 32_000) + Math.random() * 1000;
      console.warn(`[asistente:gmail] ${codigo} — reintentando en ${Math.round(espera)}ms…`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimoError;
}

function leerEncabezado(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, nombre: string): string | undefined {
  const encontrado = headers?.find((h) => h.name?.toLowerCase() === nombre.toLowerCase());
  return encontrado?.value ?? undefined;
}

/** Recorre las partes del mensaje buscando el primer text/plain con contenido. */
function extraerCuerpo(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }
  for (const parte of payload.parts ?? []) {
    const texto = extraerCuerpo(parte);
    if (texto.trim()) return texto;
  }
  // Sin text/plain: caemos al HTML desnudo antes que quedarnos sin contenido.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url")
      .toString("utf8")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
  }
  return "";
}

/**
 * Lista los IDs de correos de la bandeja de entrada posteriores a `desde`.
 * Solo trae IDs (barato); el contenido se pide uno por uno después.
 */
export async function listarCorreosNuevos(
  gmail: gmail_v1.Gmail,
  desde: Date | null,
  maximo: number,
): Promise<string[]> {
  // `after` de Gmail trabaja en segundos epoch. Sin marca previa miramos solo
  // el último día para que el primer arranque no procese años de bandeja.
  const referencia = desde ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const consulta = `in:inbox -in:chats after:${Math.floor(referencia.getTime() / 1000)}`;

  const res = await conReintentos(() =>
    gmail.users.messages.list({ userId: "me", q: consulta, maxResults: maximo }),
  );
  return (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
}

/** Trae encabezados y cuerpo de un correo concreto. */
export async function obtenerCorreo(gmail: gmail_v1.Gmail, id: string): Promise<CorreoGmail | null> {
  const res = await conReintentos(() => gmail.users.messages.get({ userId: "me", id, format: "full" }));
  const mensaje = res.data;
  if (!mensaje.payload) return null;

  const headers = mensaje.payload.headers;
  return {
    id: mensaje.id!,
    threadId: mensaje.threadId!,
    encabezados: {
      from: leerEncabezado(headers, "From") ?? "",
      subject: leerEncabezado(headers, "Subject") ?? "(sin asunto)",
      listUnsubscribe: leerEncabezado(headers, "List-Unsubscribe"),
      precedence: leerEncabezado(headers, "Precedence"),
      autoSubmitted: leerEncabezado(headers, "Auto-Submitted"),
    },
    // 4000 caracteres bastan para clasificar y acotan el gasto de tokens.
    cuerpo: extraerCuerpo(mensaje.payload).slice(0, 4000),
    recibidoEn: mensaje.internalDate
      ? new Date(Number(mensaje.internalDate)).toISOString()
      : new Date().toISOString(),
  };
}

/**
 * Crea un BORRADOR de respuesta en el hilo original. Nunca envía: el scope
 * gmail.compose no lo permite, por diseño — la última palabra es del humano.
 */
export async function crearBorrador(
  gmail: gmail_v1.Gmail,
  args: { threadId: string; para: string; asunto: string; cuerpo: string },
): Promise<string | null> {
  const asunto = args.asunto.toLowerCase().startsWith("re:") ? args.asunto : `Re: ${args.asunto}`;
  // Codificamos el asunto en base64 (RFC 2047) para no romper con acentos.
  const asuntoCodificado = `=?UTF-8?B?${Buffer.from(asunto, "utf8").toString("base64")}?=`;

  const mime = [
    `To: ${args.para}`,
    `Subject: ${asuntoCodificado}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    args.cuerpo,
  ].join("\r\n");

  const res = await conReintentos(() =>
    gmail.users.drafts.create({
      userId: "me",
      requestBody: {
        message: { threadId: args.threadId, raw: Buffer.from(mime, "utf8").toString("base64url") },
      },
    }),
  );
  return res.data.id ?? null;
}

/** Busca la etiqueta `Asistente Stage/<sufijo>` y la crea si no existe. */
export async function asegurarEtiqueta(gmail: gmail_v1.Gmail, sufijo: string): Promise<string | null> {
  const nombre = `${ETIQUETA_BASE}/${sufijo}`;
  try {
    const existentes = await conReintentos(() => gmail.users.labels.list({ userId: "me" }));
    const encontrada = existentes.data.labels?.find((l) => l.name === nombre);
    if (encontrada?.id) return encontrada.id;

    const creada = await conReintentos(() =>
      gmail.users.labels.create({
        userId: "me",
        requestBody: { name: nombre, labelListVisibility: "labelShow", messageListVisibility: "show" },
      }),
    );
    return creada.data.id ?? null;
  } catch (err) {
    // Etiquetar es cosmético: si falla, el triaje debe continuar igual.
    console.warn(`[asistente:gmail] No se pudo asegurar la etiqueta "${nombre}":`, err);
    return null;
  }
}

/** Aplica una etiqueta ya existente a un mensaje. */
export async function etiquetarCorreo(gmail: gmail_v1.Gmail, mensajeId: string, etiquetaId: string): Promise<void> {
  try {
    await conReintentos(() =>
      gmail.users.messages.modify({ userId: "me", id: mensajeId, requestBody: { addLabelIds: [etiquetaId] } }),
    );
  } catch (err) {
    console.warn(`[asistente:gmail] No se pudo etiquetar el mensaje ${mensajeId}:`, err);
  }
}

/** Correo de la cuenta conectada, para confirmar en el dashboard que es la correcta. */
export async function obtenerPerfil(gmail: gmail_v1.Gmail): Promise<{ email: string; total: number } | null> {
  try {
    const res = await conReintentos(() => gmail.users.getProfile({ userId: "me" }));
    return { email: res.data.emailAddress ?? "", total: Number(res.data.messagesTotal ?? 0) };
  } catch {
    return null;
  }
}
