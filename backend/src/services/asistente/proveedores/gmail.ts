import { google, type gmail_v1 } from "googleapis";
import { obtenerClienteOAuth } from "../../calendar.js";
import {
  conReintentos,
  construirMime,
  type CorreoEntrante,
  type EmailProvider,
  type EstadoRespuesta,
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
    // El seguimiento fiable vive en Supabase. Aplicar etiquetas al mensaje
    // exigiría `gmail.modify`, un permiso mucho más amplio para una función
    // puramente cosmética. Conservamos el método como no-op para que Gmail use
    // solo lectura + composición y el resto del pipeline siga agnóstico.
    void correoId;
    void etiqueta;
  }

  async estadoRespuesta(ref: { borradorId: string; hiloId: string }): Promise<EstadoRespuesta> {
    try {
      await conReintentos(() => this.gmail.users.drafts.get({ userId: "me", id: ref.borradorId }), "gmail");
    } catch (err: any) {
      const codigo = err?.code ?? err?.response?.status;
      // 404: el borrador desapareció. Gmail lo borra tanto al enviarlo como al
      // descartarlo, y no deja rastro que permita distinguirlo — así que se
      // reporta resuelto sin afirmar cuál de las dos cosas fue.
      if (codigo === 404) return "resuelta";
      console.warn(`[asistente:gmail] No se pudo consultar el borrador ${ref.borradorId}:`, err);
      return "desconocido";
    }

    // El borrador sigue ahí, pero el titular pudo haber respondido aparte
    // (típico desde el móvil): lo que importa es si el hilo ya tiene una
    // respuesta suya, no si el borrador quedó huérfano.
    return (await this.hiloYaRespondido(ref.hiloId)) ? "enviada" : "pendiente";
  }

  /** ¿Hay algún mensaje con la etiqueta SENT en esta conversación? */
  private async hiloYaRespondido(hiloId: string): Promise<boolean> {
    if (!hiloId) return false;
    try {
      const hilo = await conReintentos(
        () => this.gmail.users.threads.get({ userId: "me", id: hiloId, format: "minimal" }),
        "gmail",
      );
      return (hilo.data.messages ?? []).some((m) => (m.labelIds ?? []).includes("SENT"));
    } catch (err) {
      console.warn(`[asistente:gmail] No se pudo revisar la conversación ${hiloId}:`, err);
      return false;
    }
  }

}

/** Construye el adaptador de Gmail, o null si el tenant no tiene Google conectado. */
export async function crearProveedorGmail(tenantId: string): Promise<EmailProvider | null> {
  const auth = await obtenerClienteOAuth(tenantId);
  if (!auth) return null;
  return new ProveedorGmail(google.gmail({ version: "v1", auth }));
}
