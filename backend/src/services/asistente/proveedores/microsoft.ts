import { config } from "../../../lib/config.js";
import { supabase } from "../../../lib/supabase.js";
import { cifrar, descifrar } from "../../../lib/cripto.js";
import {
  asuntoDeRespuesta,
  conReintentos,
  NOMBRE_ETIQUETA,
  type CorreoEntrante,
  type EmailProvider,
  type EstadoRespuesta,
  type EtiquetaAsistente,
  type PerfilCorreo,
  type RespuestaCorreo,
} from "./tipos.js";

/**
 * Adaptador de Microsoft (Outlook.com, Hotmail, Microsoft 365) sobre Graph.
 *
 * Se habla REST directo en vez de traer el SDK de Graph: son cinco endpoints y
 * el SDK arrastra dependencias que no necesitamos.
 *
 * Una sola app registrada en Entra ID sirve para todos los tenants; cada
 * cliente autoriza su cuenta y su refresh_token queda cifrado en
 * `asistente_cuentas`.
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * Permisos mínimos: leer el buzón, escribir/enviar en nombre del usuario, y
 * User.Read para poder confirmar QUÉ cuenta se autorizó.
 *
 * User.Read no es opcional aunque suene a extra: sin él, `GET /me` devuelve
 * 403 y el dashboard reporta "Sin conectar" aunque el triaje funcione — que
 * es exactamente lo que pasaba antes de agregarlo.
 */
export const SCOPES_MICROSOFT = [
  "offline_access",
  "openid",
  "email",
  "https://graph.microsoft.com/User.Read",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
];

/**
 * Extrae el correo del `id_token` (JWT) sin verificar la firma: viene por
 * canal seguro directo de Microsoft y solo se usa para mostrarlo. Sirve de
 * respaldo cuando `/me` no está disponible.
 */
function emailDelIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const carga = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"));
    const email = carga.email ?? carga.preferred_username ?? carga.upn;
    return typeof email === "string" && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

function urlToken(): string {
  return `https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/token`;
}

/** URL de consentimiento para que el dashboard redirija al usuario. */
export function generarUrlAutorizacionMicrosoft(state: string, redirectUri: string, loginHint?: string): string {
  if (!config.microsoft.clientId) {
    throw new Error("Falta configurar MICROSOFT_OAUTH_CLIENT_ID / SECRET en el backend.");
  }
  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES_MICROSOFT.join(" "),
    state,
    // Fuerza a Microsoft a devolver refresh_token aunque ya hubiera consentido.
    prompt: "consent",
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `https://login.microsoftonline.com/${config.microsoft.tenantId}/oauth2/v2.0/authorize?${params}`;
}

interface RespuestaToken {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

async function pedirToken(cuerpo: Record<string, string>): Promise<RespuestaToken> {
  const res = await fetch(urlToken(), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.microsoft.clientId,
      client_secret: config.microsoft.clientSecret,
      ...cuerpo,
    }),
  });
  if (!res.ok) {
    throw new Error(`Microsoft rechazó la petición de token (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return (await res.json()) as RespuestaToken;
}

/** Intercambia el `code` del callback por tokens y los guarda cifrados para ESE tenant. */
export async function manejarCallbackMicrosoft(tenantId: string, code: string, redirectUri: string): Promise<void> {
  const tokens = await pedirToken({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
  if (!tokens.refresh_token) {
    throw new Error("Microsoft no devolvió un refresh_token. Vuelve a intentar la autorización.");
  }

  // El correo se guarda de una vez para poder avisar en el dashboard si se
  // autorizó una cuenta distinta a la configurada. Se toma del id_token, que
  // siempre viene; `/me` queda como refuerzo por si el id_token no lo trae.
  let email: string | null = emailDelIdToken(tokens.id_token);
  if (!email) {
    try {
      const perfil = await fetch(`${GRAPH}/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } });
      if (perfil.ok) {
        const datos: any = await perfil.json();
        email = datos.mail ?? datos.userPrincipalName ?? null;
      }
    } catch {
      // Informativo: no bloquea la conexión.
    }
  }

  const { error } = await supabase.from("asistente_cuentas").upsert({
    tenant_id: tenantId,
    proveedor: "microsoft",
    cuenta_email: email,
    credenciales: cifrar(JSON.stringify({ refreshToken: tokens.refresh_token })),
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Canjea el refresh_token guardado por un access_token fresco. */
async function accessTokenDe(tenantId: string): Promise<{ token: string; email: string | null } | null> {
  const { data, error } = await supabase
    .from("asistente_cuentas")
    .select("credenciales, cuenta_email")
    .eq("tenant_id", tenantId)
    .eq("proveedor", "microsoft")
    .maybeSingle();
  if (error || !data?.credenciales) return null;

  try {
    const { refreshToken } = JSON.parse(descifrar(data.credenciales)) as { refreshToken: string };
    // Sin `scope`: el refresh renueva EXACTAMENTE los permisos que el usuario
    // concedió. Mandar la lista actual rompe todas las cuentas conectadas
    // antes de agregar un permiso nuevo — Microsoft responde AADSTS70000 y
    // deja de refrescar, aunque los permisos viejos siguieran siendo válidos.
    const tokens = await pedirToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    // Microsoft rota el refresh_token: si no guardamos el nuevo, la conexión
    // se cae sola en unos días.
    if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
      await supabase
        .from("asistente_cuentas")
        .update({ credenciales: cifrar(JSON.stringify({ refreshToken: tokens.refresh_token })) })
        .eq("tenant_id", tenantId);
    }
    return { token: tokens.access_token, email: data.cuenta_email ?? emailDelIdToken(tokens.id_token) };
  } catch (err) {
    console.error(`[asistente:microsoft] No se pudo refrescar el token de ${tenantId}:`, err);
    return null;
  }
}

class ProveedorMicrosoft implements EmailProvider {
  readonly proveedor = "microsoft" as const;

  constructor(
    private readonly accessToken: string,
    /** Correo guardado al autorizar; respaldo si `/me` no está disponible. */
    private readonly emailGuardado: string | null,
  ) {}

  private async llamar(ruta: string, init: RequestInit = {}): Promise<any> {
    return conReintentos(async () => {
      const res = await fetch(`${GRAPH}${ruta}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      if (!res.ok) {
        const error: any = new Error(`Graph ${res.status}: ${(await res.text()).slice(0, 300)}`);
        error.status = res.status;
        throw error;
      }
      // 202/204 (enviar, marcar) no traen cuerpo.
      return res.status === 204 || res.status === 202 ? null : await res.json();
    }, "microsoft");
  }

  async perfil(): Promise<PerfilCorreo | null> {
    try {
      const datos = await this.llamar("/me?$select=mail,userPrincipalName");
      const email = datos?.mail ?? datos?.userPrincipalName ?? this.emailGuardado;
      if (email) return { email };
    } catch (err) {
      // Las cuentas autorizadas ANTES de que pidiéramos User.Read siguen
      // sirviendo para triar, pero no pueden leer /me. No las reportamos como
      // desconectadas: lo que importa es si el buzón responde.
      console.warn("[asistente:microsoft] /me no disponible; verificando con el buzón:", err);
    }

    try {
      await this.llamar("/me/mailFolders/inbox?$select=id");
      return { email: this.emailGuardado ?? "" };
    } catch {
      return null;
    }
  }

  async listarNuevos(desde: Date | null, maximo: number): Promise<string[]> {
    const referencia = desde ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const filtro = `receivedDateTime gt ${referencia.toISOString()}`;
    const datos = await this.llamar(
      `/me/mailFolders/inbox/messages?$select=id&$top=${maximo}&$filter=${encodeURIComponent(filtro)}&$orderby=receivedDateTime desc`,
    );
    return (datos?.value ?? []).map((m: any) => m.id).filter(Boolean);
  }

  async obtener(id: string): Promise<CorreoEntrante | null> {
    const m = await this.llamar(
      `/me/messages/${id}?$select=id,conversationId,subject,from,receivedDateTime,body,bodyPreview,internetMessageId,internetMessageHeaders`,
    );
    if (!m) return null;

    // Graph entrega los encabezados crudos solo si se piden; los que usa la
    // heurística se buscan ahí.
    const crudos: { name: string; value: string }[] = m.internetMessageHeaders ?? [];
    const encabezado = (nombre: string) =>
      crudos.find((h) => h.name?.toLowerCase() === nombre.toLowerCase())?.value;

    const remitente = m.from?.emailAddress;
    const cuerpo: string =
      m.body?.contentType === "html"
        ? String(m.body?.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
        : String(m.body?.content ?? m.bodyPreview ?? "");

    return {
      id: m.id,
      hiloId: m.conversationId ?? m.id,
      encabezados: {
        from: remitente ? `${remitente.name ?? ""} <${remitente.address ?? ""}>`.trim() : "",
        subject: m.subject || "(sin asunto)",
        listUnsubscribe: encabezado("List-Unsubscribe"),
        precedence: encabezado("Precedence"),
        autoSubmitted: encabezado("Auto-Submitted"),
      },
      messageId: m.internetMessageId,
      cuerpo: cuerpo.slice(0, 4000),
      recibidoEn: m.receivedDateTime ?? new Date().toISOString(),
    };
  }

  async crearBorrador(respuesta: RespuestaCorreo): Promise<string | null> {
    const creado = await this.llamar("/me/messages", {
      method: "POST",
      body: JSON.stringify({
        subject: asuntoDeRespuesta(respuesta.asunto),
        body: { contentType: "Text", content: respuesta.cuerpo },
        toRecipients: [{ emailAddress: { address: respuesta.para } }],
        // Deja el borrador dentro de la conversación original.
        conversationId: respuesta.hiloId,
      }),
    });
    return creado?.id ?? null;
  }

  async enviar(respuesta: RespuestaCorreo): Promise<string | null> {
    await this.llamar("/me/sendMail", {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: asuntoDeRespuesta(respuesta.asunto),
          body: { contentType: "Text", content: respuesta.cuerpo },
          toRecipients: [{ emailAddress: { address: respuesta.para } }],
        },
        saveToSentItems: true,
      }),
    });
    // sendMail responde 202 sin cuerpo: no hay id que devolver.
    return null;
  }

  async estadoRespuesta(borradorId: string): Promise<EstadoRespuesta> {
    try {
      // Graph conserva el id al enviar: el mensaje pasa a Elementos enviados y
      // isDraft cambia a false. Eso permite distinguir enviado de descartado,
      // cosa que en Gmail no se puede.
      const mensaje = await this.llamar(`/me/messages/${borradorId}?$select=isDraft`);
      return mensaje?.isDraft === false ? "enviada" : "pendiente";
    } catch (err: any) {
      if (err?.status === 404) return "descartada";
      console.warn(`[asistente:microsoft] No se pudo consultar el borrador ${borradorId}:`, err);
      return "desconocido";
    }
  }

  async etiquetar(correoId: string, etiqueta: EtiquetaAsistente): Promise<void> {
    try {
      // Graph no tiene etiquetas como Gmail; el equivalente son las categorías.
      await this.llamar(`/me/messages/${correoId}`, {
        method: "PATCH",
        body: JSON.stringify({ categories: [`Asistente Stage — ${NOMBRE_ETIQUETA[etiqueta]}`] }),
      });
    } catch (err) {
      console.warn(`[asistente:microsoft] No se pudo marcar ${correoId}:`, err);
    }
  }
}

/** Construye el adaptador de Microsoft, o null si el tenant no lo tiene conectado. */
export async function crearProveedorMicrosoft(tenantId: string): Promise<EmailProvider | null> {
  if (!config.microsoft.clientId || !config.microsoft.clientSecret) return null;
  const credenciales = await accessTokenDe(tenantId);
  return credenciales ? new ProveedorMicrosoft(credenciales.token, credenciales.email) : null;
}
