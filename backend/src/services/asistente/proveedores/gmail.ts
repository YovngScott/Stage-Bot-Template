import { google, type gmail_v1 } from "googleapis";
import { obtenerClienteOAuth } from "../../calendar.js";
import {
  conReintentos,
  construirMime,
  NOMBRE_ETIQUETA,
  type CorreoEntrante,
  type EmailProvider,
  type EtiquetaAsistente,
  type PerfilCorreo,
  type RespuestaCorreo,
} from "./tipos.js";

/**
 * Adaptador de Gmail. Reutiliza la MISMA conexión OAuth por tenant que ya usa
 * Google Calendar (tabla google_oauth_tokens): el cliente autoriza una vez y
 * sirve para las dos cosas.
 *
 * Ingesta por consultas programadas (list + get) en vez de webhooks: evita
 * depender de Pub/Sub y mantiene el consumo de cuota predecible.
 */

/** Etiqueta padre bajo la que cuelgan las marcas del asistente. */
const ETIQUETA_BASE = "Asistente Stage";

function leerEncabezado(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, nombre: string): string | undefined {
  return headers?.find((h) => h.name?.toLowerCase() === nombre.toLowerCase())?.value ?? undefined;
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

class ProveedorGmail implements EmailProvider {
  readonly proveedor = "gmail" as const;
  /** id de cada etiqueta ya resuelta, para no volver a consultarlas en la misma corrida. */
  private etiquetas = new Map<EtiquetaAsistente, string | null>();

  constructor(private readonly gmail: gmail_v1.Gmail) {}

  async perfil(): Promise<PerfilCorreo | null> {
    try {
      const res = await conReintentos(() => this.gmail.users.getProfile({ userId: "me" }), "gmail");
      return { email: res.data.emailAddress ?? "" };
    } catch {
      return null;
    }
  }

  async listarNuevos(desde: Date | null, maximo: number): Promise<string[]> {
    // `after` de Gmail trabaja en segundos epoch. Sin marca previa miramos solo
    // el último día para que el primer arranque no procese años de bandeja.
    const referencia = desde ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const consulta = `in:inbox -in:chats after:${Math.floor(referencia.getTime() / 1000)}`;

    const res = await conReintentos(
      () => this.gmail.users.messages.list({ userId: "me", q: consulta, maxResults: maximo }),
      "gmail",
    );
    return (res.data.messages ?? []).map((m) => m.id!).filter(Boolean);
  }

  async obtener(id: string): Promise<CorreoEntrante | null> {
    const res = await conReintentos(
      () => this.gmail.users.messages.get({ userId: "me", id, format: "full" }),
      "gmail",
    );
    const mensaje = res.data;
    if (!mensaje.payload) return null;

    const headers = mensaje.payload.headers;
    return {
      id: mensaje.id!,
      hiloId: mensaje.threadId!,
      encabezados: {
        from: leerEncabezado(headers, "From") ?? "",
        subject: leerEncabezado(headers, "Subject") ?? "(sin asunto)",
        listUnsubscribe: leerEncabezado(headers, "List-Unsubscribe"),
        precedence: leerEncabezado(headers, "Precedence"),
        autoSubmitted: leerEncabezado(headers, "Auto-Submitted"),
      },
      messageId: leerEncabezado(headers, "Message-Id"),
      // 4000 caracteres bastan para clasificar y acotan el gasto de tokens.
      cuerpo: extraerCuerpo(mensaje.payload).slice(0, 4000),
      recibidoEn: mensaje.internalDate
        ? new Date(Number(mensaje.internalDate)).toISOString()
        : new Date().toISOString(),
    };
  }

  async crearBorrador(respuesta: RespuestaCorreo): Promise<string | null> {
    const res = await conReintentos(
      () =>
        this.gmail.users.drafts.create({
          userId: "me",
          requestBody: {
            message: {
              threadId: respuesta.hiloId,
              raw: Buffer.from(construirMime(respuesta), "utf8").toString("base64url"),
            },
          },
        }),
      "gmail",
    );
    return res.data.id ?? null;
  }

  async enviar(respuesta: RespuestaCorreo): Promise<string | null> {
    const res = await conReintentos(
      () =>
        this.gmail.users.messages.send({
          userId: "me",
          requestBody: {
            threadId: respuesta.hiloId,
            raw: Buffer.from(construirMime(respuesta), "utf8").toString("base64url"),
          },
        }),
      "gmail",
    );
    return res.data.id ?? null;
  }

  async etiquetar(correoId: string, etiqueta: EtiquetaAsistente): Promise<void> {
    try {
      const id = await this.asegurarEtiqueta(etiqueta);
      if (!id) return;
      await conReintentos(
        () => this.gmail.users.messages.modify({ userId: "me", id: correoId, requestBody: { addLabelIds: [id] } }),
        "gmail",
      );
    } catch (err) {
      // Etiquetar es cosmético: si falla, el triaje debe continuar igual.
      console.warn(`[asistente:gmail] No se pudo etiquetar ${correoId}:`, err);
    }
  }

  /** Busca la etiqueta `Asistente Stage/<nombre>` y la crea si no existe. */
  private async asegurarEtiqueta(etiqueta: EtiquetaAsistente): Promise<string | null> {
    if (this.etiquetas.has(etiqueta)) return this.etiquetas.get(etiqueta)!;

    const nombre = `${ETIQUETA_BASE}/${NOMBRE_ETIQUETA[etiqueta]}`;
    let id: string | null = null;
    try {
      const existentes = await conReintentos(() => this.gmail.users.labels.list({ userId: "me" }), "gmail");
      id = existentes.data.labels?.find((l) => l.name === nombre)?.id ?? null;

      if (!id) {
        const creada = await conReintentos(
          () =>
            this.gmail.users.labels.create({
              userId: "me",
              requestBody: { name: nombre, labelListVisibility: "labelShow", messageListVisibility: "show" },
            }),
          "gmail",
        );
        id = creada.data.id ?? null;
      }
    } catch (err) {
      console.warn(`[asistente:gmail] No se pudo asegurar la etiqueta "${nombre}":`, err);
    }
    this.etiquetas.set(etiqueta, id);
    return id;
  }
}

/** Construye el adaptador de Gmail, o null si el tenant no tiene Google conectado. */
export async function crearProveedorGmail(tenantId: string): Promise<EmailProvider | null> {
  const auth = await obtenerClienteOAuth(tenantId);
  if (!auth) return null;
  return new ProveedorGmail(google.gmail({ version: "v1", auth }));
}
