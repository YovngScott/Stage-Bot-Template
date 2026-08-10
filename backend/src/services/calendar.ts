import { google, type calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { config } from "../lib/config.js";
import { cifradoDisponible, cifrar, descifrar } from "../lib/cripto.js";
import { supabase } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";

const SCOPES_OAUTH = ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/userinfo.email"];

/**
 * Scopes extra del asistente virtual. Deliberadamente NO pedimos `gmail.send`
 * ni `gmail.modify`: `gmail.compose` permite dejar borradores pero jamás
 * enviarlos sin que una persona lo apruebe, y `readonly` es lo mínimo para
 * poder triar la bandeja. Esto también simplifica la verificación de Google.
 */
const SCOPES_ASISTENTE = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.labels",
];

/**
 * Integración con Google Calendar, UNA conexión OAuth por tenant. El Client
 * ID/Secret de la app de Google Cloud es compartido (variable de entorno);
 * cada tenant autoriza con SU propia cuenta desde el dashboard, y su
 * refresh_token queda guardado por separado (google_oauth_tokens, keyed por
 * tenant_id).
 */

interface TokensGuardados {
  refresh_token: string;
  access_token: string | null;
  expiry_date: number | null;
}

function protegerToken(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (!cifradoDisponible()) {
    throw new Error("Falta CREDENCIALES_SECRET para guardar tokens OAuth de Google de forma segura.");
  }
  return cifrar(valor);
}

function leerToken(valor: string | null): string | null {
  if (!valor) return null;
  // Compatibilidad con tokens históricos en claro. La próxima autorización
  // los reemplaza por valores cifrados sin bloquear al cliente actual.
  if (valor.split(".").length !== 3) return valor;
  return descifrar(valor);
}

function crearOAuthClient(redirectUri?: string): OAuth2Client | null {
  if (!config.google.oauthClientId || !config.google.oauthClientSecret) return null;
  return new google.auth.OAuth2(config.google.oauthClientId, config.google.oauthClientSecret, redirectUri);
}

/**
 * URL de consentimiento de Google para que el dashboard redirija al usuario.
 * `state` debe incluir el slug del tenant.
 *
 * - `incluirGmail`: agrega los scopes de triaje de correo (bots tipo asistente).
 * - `loginHint`: correo que el bot va a asistir, para que Google ya lo
 *   preseleccione y el ejecutivo no autorice la cuenta equivocada.
 */
export function generarUrlAutorizacion(
  state: string,
  redirectUri: string,
  opciones: { incluirGmail?: boolean; loginHint?: string } = {},
): string {
  const client = crearOAuthClient(redirectUri);
  if (!client) {
    throw new Error("Falta configurar GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET en el backend.");
  }
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: opciones.incluirGmail ? [...SCOPES_OAUTH, ...SCOPES_ASISTENTE] : SCOPES_OAUTH,
    ...(opciones.loginHint ? { login_hint: opciones.loginHint } : {}),
    state,
  });
}

/** Cliente OAuth autenticado de un tenant, reutilizable por cualquier API de Google. */
export async function obtenerClienteOAuth(tenantId: string): Promise<OAuth2Client | null> {
  if (!config.google.oauthClientId || !config.google.oauthClientSecret) return null;
  const tokens = await obtenerTokensGuardados(tenantId);
  if (!tokens) return null;

  const client = new google.auth.OAuth2(config.google.oauthClientId, config.google.oauthClientSecret);
  client.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? undefined,
    expiry_date: tokens.expiry_date ?? undefined,
  });
  client.on("tokens", (nuevos) => {
    if (nuevos.access_token) {
      try {
        const accessToken = protegerToken(nuevos.access_token);
        supabase
          .from("google_oauth_tokens")
          .update({ access_token: accessToken, expiry_date: nuevos.expiry_date ?? null })
          .eq("tenant_id", tenantId)
          .then(({ error }) => {
            if (error) console.error(`[oauth:${tenantId}] No se pudo guardar el token renovado:`, error);
          });
      } catch (error) {
        console.error(`[oauth:${tenantId}] No se pudo cifrar el token renovado:`, error);
      }
    }
  });
  return client;
}

/** Intercambia el `code` del callback por tokens y los guarda para ESE tenant. */
export async function manejarCallbackOAuth(tenantId: string, code: string, redirectUri: string): Promise<void> {
  const client = crearOAuthClient(redirectUri);
  if (!client) throw new Error("Falta configurar GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.");

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google no devolvió un refresh_token (puede pasar si ya habías autorizado antes). Quita el acceso en https://myaccount.google.com/permissions y vuelve a intentar.",
    );
  }
  client.setCredentials(tokens);

  let email: string | null = null;
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const info = await oauth2.userinfo.get();
    email = info.data.email ?? null;
  } catch {
    // el email es solo informativo para el dashboard; no bloquea la conexión
  }

  const { error } = await supabase.from("google_oauth_tokens").upsert({
    tenant_id: tenantId,
    refresh_token: protegerToken(tokens.refresh_token),
    access_token: protegerToken(tokens.access_token),
    expiry_date: tokens.expiry_date ?? null,
    cuenta_email: email,
    actualizado_en: new Date().toISOString(),
  });
  if (error) throw error;
}

/** Quita la conexión OAuth guardada de un tenant. */
export async function desconectarOAuth(tenantId: string): Promise<void> {
  const { error } = await supabase.from("google_oauth_tokens").delete().eq("tenant_id", tenantId);
  if (error) throw error;
}

async function obtenerTokensGuardados(tenantId: string): Promise<TokensGuardados | null> {
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select("refresh_token, access_token, expiry_date")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    refresh_token: leerToken(data.refresh_token) ?? "",
    access_token: leerToken(data.access_token),
    expiry_date: data.expiry_date,
  };
}

async function obtenerClienteCalendar(tenantId: string): Promise<calendar_v3.Calendar | null> {
  const client = await obtenerClienteOAuth(tenantId);
  if (!client) return null;
  return google.calendar({ version: "v3", auth: client });
}

export interface NuevaCita {
  tenant: Tenant;
  clienteId: string;
  clienteNombre: string;
  clienteTelefono: string;
  inicioISO: string;
  duracionMinutos: number;
  motivo: string;
}

const agendasEnCurso = new Map<string, Promise<void>>();

function validarIntervalo(inicioISO: string, duracionMinutos: number): { inicio: string; fin: string } {
  const inicioMs = new Date(inicioISO).getTime();
  if (!Number.isFinite(inicioMs)) throw new Error("La fecha de la cita no es válida.");
  if (!Number.isInteger(duracionMinutos) || duracionMinutos < 15 || duracionMinutos > 480) {
    throw new Error("La duración debe estar entre 15 minutos y 8 horas.");
  }
  if (inicioMs < Date.now() - 5 * 60_000) throw new Error("No se puede agendar una cita en el pasado.");
  if (inicioMs > Date.now() + 366 * 24 * 60 * 60_000) throw new Error("La cita no puede quedar a más de un año.");
  return {
    inicio: new Date(inicioMs).toISOString(),
    fin: new Date(inicioMs + duracionMinutos * 60_000).toISOString(),
  };
}

/** Crea el evento en Google Calendar (si está conectado) y lo espeja en `citas`. */
export async function agendarCita(cita: NuevaCita): Promise<{ citaId: string; googleEventId: string | null }> {
  const { tenant } = cita;
  const anterior = agendasEnCurso.get(tenant.id) ?? Promise.resolve();
  let liberar!: () => void;
  const turno = new Promise<void>((resolve) => { liberar = resolve; });
  const encolado = anterior.then(() => turno);
  agendasEnCurso.set(tenant.id, encolado);
  await anterior;

  try {
    const { inicio, fin } = validarIntervalo(cita.inicioISO, cita.duracionMinutos);
    if (!(await horarioDisponible(tenant, inicio, cita.duracionMinutos))) {
      throw new Error("Ese horario ya no está disponible. Propón otro antes de confirmar.");
    }

    let googleEventId: string | null = null;

    const calendar = await obtenerClienteCalendar(tenant.id);
    if (calendar) {
      const evento = await calendar.events.insert({
        calendarId: tenant.config.googleCalendarId,
        requestBody: {
          summary: `${tenant.config.nombre}: ${String(cita.motivo ?? "Cita").slice(0, 200)} — ${cita.clienteNombre}`,
          description: `Cliente: ${cita.clienteNombre}\nTeléfono: ${cita.clienteTelefono}\nMotivo: ${String(cita.motivo ?? "").slice(0, 1000)}\n(Agendado por el bot de WhatsApp)`,
          start: { dateTime: inicio, timeZone: tenant.config.zonaHoraria },
          end: { dateTime: fin, timeZone: tenant.config.zonaHoraria },
        },
      });
      googleEventId = evento.data.id ?? null;
    } else {
      console.warn(`[calendar] Google Calendar no está conectado para "${tenant.config.slug}": la cita solo se guarda en Supabase.`);
    }

    const { data, error } = await supabase
      .from("citas")
      .insert({
        tenant_id: tenant.id,
        cliente_id: cita.clienteId,
        google_event_id: googleEventId,
        inicio,
        fin,
        motivo: String(cita.motivo ?? "").slice(0, 1000),
      })
      .select("id")
      .single();

    if (error) {
      // Evita un evento huérfano si Google aceptó pero Supabase falló.
      if (calendar && googleEventId) {
        await calendar.events.delete({ calendarId: tenant.config.googleCalendarId, eventId: googleEventId }).catch(() => {});
      }
      throw error;
    }
    return { citaId: data.id, googleEventId };
  } finally {
    liberar();
    if (agendasEnCurso.get(tenant.id) === encolado) agendasEnCurso.delete(tenant.id);
  }
}

/** Estado de la conexión con Google Calendar de un tenant, para el dashboard. */
export async function verificarConexionCalendar(tenant: Tenant): Promise<{
  credencialesConfiguradas: boolean;
  conectado: boolean;
  calendarId: string;
  cuentaEmail: string | null;
  error: string | null;
}> {
  const credencialesConfiguradas = Boolean(config.google.oauthClientId && config.google.oauthClientSecret);
  const calendar = await obtenerClienteCalendar(tenant.id);

  if (!calendar) {
    return {
      credencialesConfiguradas,
      conectado: false,
      calendarId: tenant.config.googleCalendarId,
      cuentaEmail: null,
      error: credencialesConfiguradas
        ? 'Sin conectar. Usa el botón "Conectar con Google".'
        : "El backend no tiene configurado GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET.",
    };
  }

  try {
    await calendar.calendarList.get({ calendarId: tenant.config.googleCalendarId });
    const { data } = await supabase
      .from("google_oauth_tokens")
      .select("cuenta_email")
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    return {
      credencialesConfiguradas,
      conectado: true,
      calendarId: tenant.config.googleCalendarId,
      cuentaEmail: data?.cuenta_email ?? null,
      error: null,
    };
  } catch (err: any) {
    return {
      credencialesConfiguradas,
      conectado: false,
      calendarId: tenant.config.googleCalendarId,
      cuentaEmail: null,
      error: err?.message ?? "No se pudo conectar con Google Calendar.",
    };
  }
}

/** Verifica si un horario está libre para ESTE tenant. */
export async function horarioDisponible(tenant: Tenant, inicioISO: string, duracionMinutos: number): Promise<boolean> {
  const { inicio, fin } = validarIntervalo(inicioISO, duracionMinutos);

  const { data, error } = await supabase
    .from("citas")
    .select("id")
    .eq("tenant_id", tenant.id)
    .in("estado", ["confirmada", "reprogramada"])
    .lt("inicio", fin)
    .gt("fin", inicio)
    .limit(1);

  if (error) throw error;
  if ((data ?? []).length > 0) return false;

  const calendar = await obtenerClienteCalendar(tenant.id);
  if (!calendar) return true;
  const libres = await calendar.freebusy.query({
    requestBody: {
      timeMin: inicio,
      timeMax: fin,
      timeZone: tenant.config.zonaHoraria,
      items: [{ id: tenant.config.googleCalendarId }],
    },
  });
  return (libres.data.calendars?.[tenant.config.googleCalendarId]?.busy ?? []).length === 0;
}
