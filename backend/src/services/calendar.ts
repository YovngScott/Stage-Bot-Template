import { google, type calendar_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { config } from "../lib/config.js";
import { supabase } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";

const SCOPES_OAUTH = ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/userinfo.email"];

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

function crearOAuthClient(redirectUri?: string): OAuth2Client | null {
  if (!config.google.oauthClientId || !config.google.oauthClientSecret) return null;
  return new google.auth.OAuth2(config.google.oauthClientId, config.google.oauthClientSecret, redirectUri);
}

/** URL de consentimiento de Google para que el dashboard redirija al usuario. `state` debe incluir el slug del tenant. */
export function generarUrlAutorizacion(state: string, redirectUri: string): string {
  const client = crearOAuthClient(redirectUri);
  if (!client) {
    throw new Error("Falta configurar GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET en el backend.");
  }
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES_OAUTH,
    state,
  });
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
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token ?? null,
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
  return data as TokensGuardados | null;
}

async function obtenerClienteCalendar(tenantId: string): Promise<calendar_v3.Calendar | null> {
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
      supabase
        .from("google_oauth_tokens")
        .update({ access_token: nuevos.access_token, expiry_date: nuevos.expiry_date ?? null })
        .eq("tenant_id", tenantId)
        .then(undefined, () => {});
    }
  });
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

/** Crea el evento en Google Calendar (si está conectado) y lo espeja en `citas`. */
export async function agendarCita(cita: NuevaCita): Promise<{ citaId: string; googleEventId: string | null }> {
  const fin = new Date(new Date(cita.inicioISO).getTime() + cita.duracionMinutos * 60_000).toISOString();
  const { tenant } = cita;

  let googleEventId: string | null = null;

  const calendar = await obtenerClienteCalendar(tenant.id);
  if (calendar) {
    const evento = await calendar.events.insert({
      calendarId: tenant.config.googleCalendarId,
      requestBody: {
        summary: `${tenant.config.nombre}: ${cita.motivo} — ${cita.clienteNombre}`,
        description: `Cliente: ${cita.clienteNombre}\nTeléfono: ${cita.clienteTelefono}\nMotivo: ${cita.motivo}\n(Agendado por el bot de WhatsApp)`,
        start: { dateTime: cita.inicioISO, timeZone: tenant.config.zonaHoraria },
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
      inicio: cita.inicioISO,
      fin,
      motivo: cita.motivo,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { citaId: data.id, googleEventId };
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
export async function horarioDisponible(tenantId: string, inicioISO: string, duracionMinutos: number): Promise<boolean> {
  const inicio = new Date(inicioISO).toISOString();
  const fin = new Date(new Date(inicioISO).getTime() + duracionMinutos * 60_000).toISOString();

  const { data, error } = await supabase
    .from("citas")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("estado", ["confirmada", "reprogramada"])
    .lt("inicio", fin)
    .gt("fin", inicio)
    .limit(1);

  if (error) throw error;
  return (data ?? []).length === 0;
}
