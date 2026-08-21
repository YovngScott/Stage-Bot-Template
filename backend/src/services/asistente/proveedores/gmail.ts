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
import { analizarDocumentoPdf, analizarImagen } from "../../media.js";

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

interface PartAdjunto {
  nombre: string;
  mimeType: string;
  tamano: number;
  attachmentId?: string;
}

function extraerAdjuntos(payload: gmail_v1.Schema$MessagePart | undefined): PartAdjunto[] {
  if (!payload) return [];
  const own = payload.filename
    ? [
        {
          nombre: payload.filename,
          mimeType: payload.mimeType || "application/octet-stream",
          tamano: Number(payload.body?.size ?? 0),
          attachmentId: payload.body?.attachmentId ?? undefined,
        },
      ]
    : [];
  return [...own, ...(payload.parts ?? []).flatMap(extraerAdjuntos)];
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
    const adjuntos = extraerAdjuntos(mensaje.payload);
    let textoAdjuntos = "";

    // Descarga y analiza adjuntos PDF o imágenes pequeños (< 4MB) con Gemini
    for (const adj of adjuntos.slice(0, 3)) {
      if (!adj.attachmentId || adj.tamano > 4 * 1024 * 1024) continue;
      const esPdf = adj.mimeType.includes("pdf") || adj.nombre.toLowerCase().endsWith(".pdf");
      const esImagen = adj.mimeType.startsWith("image/");

      if (esPdf || esImagen) {
        try {
          const attRes = await conReintentos(
            () =>
              this.gmail.users.messages.attachments.get({
                userId: "me",
                messageId: id,
                id: adj.attachmentId!,
              }),
            "gmail",
          );
          if (attRes.data.data) {
            const buffer = Buffer.from(attRes.data.data, "base64url");
            if (esPdf) {
              const analisis = await analizarDocumentoPdf(buffer, "application/pdf", adj.nombre);
              if (analisis) {
                textoAdjuntos += `\n\n[Contenido del PDF adjunto '${adj.nombre}']: ${analisis}`;
              }
            } else if (esImagen) {
              const analisis = await analizarImagen(buffer, adj.mimeType);
              if (analisis) {
                textoAdjuntos += `\n\n[Imagen adjunta en el correo '${adj.nombre}']: ${analisis}`;
              }
            }
          }
        } catch (err) {
          console.warn(`[gmail] No se pudo procesar adjunto ${adj.nombre}:`, err);
        }
      }
    }

    const cuerpoCompleto = (extraerCuerpo(mensaje.payload) + textoAdjuntos).slice(0, 5000);

    return {
      id: mensaje.id!,
      hiloId: mensaje.threadId!,
      encabezados: {
        from: leerEncabezado(headers, "From") ?? "",
        subject: leerEncabezado(headers, "Subject") ?? "(sin asunto)",
        listUnsubscribe: leerEncabezado(headers, "List-Unsubscribe"),
        precedence: leerEncabezado(headers, "Precedence"),
        autoSubmitted: leerEncabezado(headers, "Auto-Submitted"),
        replyTo: leerEncabezado(headers, "Reply-To"),
      },
      messageId: leerEncabezado(headers, "Message-Id"),
      adjuntos: adjuntos.map(({ nombre, mimeType, tamano }) => ({ nombre, mimeType, tamano })),
      cuerpo: cuerpoCompleto,
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
              ...(respuesta.hiloId ? { threadId: respuesta.hiloId } : {}),
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
            ...(respuesta.hiloId ? { threadId: respuesta.hiloId } : {}),
            raw: Buffer.from(construirMime(respuesta), "utf8").toString("base64url"),
          },
        }),
      "gmail",
    );
    return res.data.id ?? null;
  }

  async etiquetar(correoId: string, etiqueta: EtiquetaAsistente): Promise<void> {
    void correoId;
    void etiqueta;
  }

  async estadoRespuesta(ref: { borradorId: string; hiloId: string }): Promise<EstadoRespuesta> {
    try {
      await conReintentos(() => this.gmail.users.drafts.get({ userId: "me", id: ref.borradorId }), "gmail");
    } catch (err: any) {
      const codigo = err?.code ?? err?.response?.status;
      if (codigo === 404) return "resuelta";
      console.warn(`[asistente:gmail] No se pudo consultar el borrador ${ref.borradorId}:`, err);
      return "desconocido";
    }
    return (await this.hiloYaRespondido(ref.hiloId)) ? "enviada" : "pendiente";
  }

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
