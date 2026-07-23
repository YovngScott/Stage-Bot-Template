import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { supabase } from "../../../lib/supabase.js";
import { cifrar, cifradoDisponible, descifrar } from "../../../lib/cripto.js";
import {
  construirMime,
  NOMBRE_ETIQUETA,
  type CorreoEntrante,
  type EmailProvider,
  type EtiquetaAsistente,
  type PerfilCorreo,
  type RespuestaCorreo,
} from "./tipos.js";

/**
 * Adaptador para cualquier correo con IMAP + SMTP: dominios corporativos,
 * hosting compartido, o cuentas de Gmail/Outlook con contraseña de aplicación
 * cuando el cliente prefiere no pasar por OAuth.
 *
 * A diferencia de Gmail y Microsoft, aquí no hay tokens revocables: la
 * credencial es una contraseña. Por eso NUNCA se guarda en claro (ver
 * lib/cripto.ts) y el dashboard no puede leer la tabla donde vive.
 */

export interface CredencialesImap {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  contrasena: string;
  smtpHost: string;
  smtpPuerto: number;
  /** Carpeta donde el proveedor guarda los borradores. Varía entre servidores. */
  carpetaBorradores: string;
}

/** Normaliza y completa lo que llega del Bot Builder. */
export function normalizarCredencialesImap(raw: any): CredencialesImap | null {
  const host = String(raw?.host ?? "").trim();
  const usuario = String(raw?.usuario ?? "").trim();
  const contrasena = String(raw?.contrasena ?? "");
  if (!host || !usuario || !contrasena) return null;

  const puerto = Number(raw?.puerto);
  const smtpPuerto = Number(raw?.smtpPuerto);
  return {
    host,
    puerto: Number.isFinite(puerto) && puerto > 0 ? puerto : 993,
    // 993 es IMAP sobre TLS; cualquier otro puerto suele ser STARTTLS.
    seguro: raw?.seguro !== undefined ? raw.seguro !== false : (Number.isFinite(puerto) ? puerto : 993) === 993,
    usuario,
    contrasena,
    smtpHost: String(raw?.smtpHost ?? "").trim() || host.replace(/^imap\./i, "smtp."),
    smtpPuerto: Number.isFinite(smtpPuerto) && smtpPuerto > 0 ? smtpPuerto : 587,
    carpetaBorradores: String(raw?.carpetaBorradores ?? "").trim() || "Drafts",
  };
}

/** Guarda las credenciales cifradas para un tenant. */
export async function guardarCredencialesImap(tenantId: string, credenciales: CredencialesImap): Promise<void> {
  if (!cifradoDisponible()) {
    throw new Error(
      "El backend no tiene CREDENCIALES_SECRET configurado. No se guardará una contraseña de correo sin cifrar.",
    );
  }
  const { error } = await supabase.from("asistente_cuentas").upsert({
    tenant_id: tenantId,
    proveedor: "imap",
    cuenta_email: credenciales.usuario,
    credenciales: cifrar(JSON.stringify(credenciales)),
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw error;
}

async function leerCredenciales(tenantId: string): Promise<CredencialesImap | null> {
  const { data, error } = await supabase
    .from("asistente_cuentas")
    .select("credenciales")
    .eq("tenant_id", tenantId)
    .eq("proveedor", "imap")
    .maybeSingle();
  if (error || !data?.credenciales) return null;

  try {
    return JSON.parse(descifrar(data.credenciales)) as CredencialesImap;
  } catch (err) {
    console.error(`[asistente:imap] No se pudieron descifrar las credenciales de ${tenantId}:`, err);
    return null;
  }
}

class ProveedorImap implements EmailProvider {
  readonly proveedor = "imap" as const;
  private cliente: ImapFlow | null = null;

  constructor(private readonly cred: CredencialesImap) {}

  /** Conexión perezosa y reutilizada: abrir IMAP por cada correo es carísimo. */
  private async conectar(): Promise<ImapFlow> {
    if (this.cliente?.usable) return this.cliente;
    const cliente = new ImapFlow({
      host: this.cred.host,
      port: this.cred.puerto,
      secure: this.cred.seguro,
      auth: { user: this.cred.usuario, pass: this.cred.contrasena },
      logger: false,
    });
    await cliente.connect();
    this.cliente = cliente;
    return cliente;
  }

  async perfil(): Promise<PerfilCorreo | null> {
    try {
      // Conectar ya valida host y credenciales: si funciona, la cuenta sirve.
      await this.conectar();
      return { email: this.cred.usuario };
    } catch (err) {
      console.error("[asistente:imap] No se pudo conectar al buzón:", err);
      return null;
    }
  }

  async listarNuevos(desde: Date | null, maximo: number): Promise<string[]> {
    const cliente = await this.conectar();
    const cerrojo = await cliente.getMailboxLock("INBOX");
    try {
      const referencia = desde ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
      // imapflow devuelve `false` si el servidor rechaza la búsqueda.
      const uids = await cliente.search({ since: referencia }, { uid: true });
      if (!uids) return [];
      // Los más recientes primero, acotado a lo que pida el llamador.
      return uids.slice(-maximo).reverse().map(String);
    } finally {
      cerrojo.release();
    }
  }

  async obtener(id: string): Promise<CorreoEntrante | null> {
    const cliente = await this.conectar();
    const cerrojo = await cliente.getMailboxLock("INBOX");
    try {
      const mensaje = await cliente.fetchOne(id, { source: true, envelope: true }, { uid: true });
      if (!mensaje || !mensaje.source) return null;

      // mailparser resuelve MIME, multipart y codificaciones; hacerlo a mano
      // sería reimplementar medio estándar de correo.
      const parseado = await simpleParser(mensaje.source);
      const cuerpo = parseado.text ?? (parseado.html ? String(parseado.html).replace(/<[^>]+>/g, " ") : "");
      const cabecera = (nombre: string) => {
        const valor = parseado.headers.get(nombre);
        return typeof valor === "string" ? valor : valor ? String(valor) : undefined;
      };

      return {
        id,
        // IMAP no expone hilos: el propio mensaje hace de ancla de la conversación.
        hiloId: id,
        encabezados: {
          from: parseado.from?.text ?? "",
          subject: parseado.subject || "(sin asunto)",
          listUnsubscribe: cabecera("list-unsubscribe"),
          precedence: cabecera("precedence"),
          autoSubmitted: cabecera("auto-submitted"),
        },
        messageId: parseado.messageId,
        cuerpo: cuerpo.replace(/\s+/g, " ").slice(0, 4000),
        recibidoEn: (parseado.date ?? new Date()).toISOString(),
      };
    } catch (err) {
      console.error(`[asistente:imap] No se pudo leer el mensaje ${id}:`, err);
      return null;
    } finally {
      cerrojo.release();
    }
  }

  async crearBorrador(respuesta: RespuestaCorreo): Promise<string | null> {
    const cliente = await this.conectar();
    const mime = Buffer.from(construirMime(respuesta), "utf8");
    // En IMAP un borrador es un APPEND con la marca \Draft. imapflow devuelve
    // `false` si el servidor lo rechaza, en vez de lanzar.
    try {
      const res = await cliente.append(this.cred.carpetaBorradores, mime, ["\\Draft"]);
      if (res && res.uid) return String(res.uid);
      if (res) return null; // guardado, pero el servidor no devolvió UID
    } catch (err) {
      console.warn(`[asistente:imap] Falló el APPEND en "${this.cred.carpetaBorradores}":`, err);
    }

    // Muchos servidores nombran la carpeta distinto ("INBOX.Drafts",
    // "Borradores"). Reintentamos en INBOX antes que perder el trabajo.
    console.warn(`[asistente:imap] Guardando el borrador en INBOX como respaldo.`);
    const respaldo = await cliente.append("INBOX", mime, ["\\Draft"]);
    return respaldo && respaldo.uid ? String(respaldo.uid) : null;
  }

  async enviar(respuesta: RespuestaCorreo): Promise<string | null> {
    const transporte = nodemailer.createTransport({
      host: this.cred.smtpHost,
      port: this.cred.smtpPuerto,
      // 465 es SMTP sobre TLS directo; 587 negocia STARTTLS.
      secure: this.cred.smtpPuerto === 465,
      auth: { user: this.cred.usuario, pass: this.cred.contrasena },
    });

    try {
      const info = await transporte.sendMail({
        from: this.cred.usuario,
        to: respuesta.para,
        subject: respuesta.asunto.toLowerCase().startsWith("re:") ? respuesta.asunto : `Re: ${respuesta.asunto}`,
        text: respuesta.cuerpo,
        ...(respuesta.messageId
          ? { inReplyTo: respuesta.messageId, references: [respuesta.messageId] }
          : {}),
      });
      return info.messageId ?? null;
    } finally {
      transporte.close();
    }
  }

  async etiquetar(correoId: string, etiqueta: EtiquetaAsistente): Promise<void> {
    try {
      const cliente = await this.conectar();
      const cerrojo = await cliente.getMailboxLock("INBOX");
      try {
        // No todos los servidores IMAP aceptan keywords propias; si este no lo
        // hace, el triaje sigue igual porque marcar es solo informativo.
        await cliente.messageFlagsAdd(correoId, [`Stage${NOMBRE_ETIQUETA[etiqueta].replace(/\s+/g, "")}`], {
          uid: true,
        });
      } finally {
        cerrojo.release();
      }
    } catch (err) {
      console.warn(`[asistente:imap] No se pudo marcar ${correoId}:`, err);
    }
  }

  async cerrar(): Promise<void> {
    if (!this.cliente) return;
    try {
      await this.cliente.logout();
    } catch {
      // La conexión ya podía estar caída; no hay nada que rescatar.
    }
    this.cliente = null;
  }
}

/** Construye el adaptador IMAP, o null si el tenant no tiene credenciales guardadas. */
export async function crearProveedorImap(tenantId: string): Promise<EmailProvider | null> {
  const cred = await leerCredenciales(tenantId);
  return cred ? new ProveedorImap(cred) : null;
}
