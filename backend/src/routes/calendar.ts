import { Router, type Request, type Response } from "express";
import { requiereAdmin } from "../lib/adminAuth.js";
import { config } from "../lib/config.js";
import { consumirEstado, generarEstado } from "../lib/oauthState.js";
import {
  verificarConexionCalendar,
  generarUrlAutorizacion,
  manejarCallbackOAuth,
  desconectarOAuth,
} from "../services/calendar.js";
import { obtenerTenant } from "../lib/tenants.js";

export const calendarRouter = Router({ mergeParams: true });

function obtenerRedirectUri(req: Request): string {
  if (config.google.oauthRedirectUri) return config.google.oauthRedirectUri;
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${req.get("host")}/api/calendar/oauth-callback`;
}

/** GET /api/:slug/calendar/status */
calendarRouter.get("/status", requiereAdmin, async (req: Request, res: Response) => {
  try {
    const estado = await verificarConexionCalendar(req.tenant!);
    res.json({ ...estado, redirectUriSugerido: obtenerRedirectUri(req) });
  } catch (err: any) {
    console.error("[calendar] Error verificando conexión:", err);
    res.status(500).json({ error: "No se pudo verificar la conexión con Google Calendar." });
  }
});

/** GET /api/:slug/calendar/auth-url */
calendarRouter.get("/auth-url", requiereAdmin, async (req: Request, res: Response) => {
  try {
    const url = generarUrlAutorizacion(generarEstado(req.tenant!.config.slug), obtenerRedirectUri(req));
    res.json({ url });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "No se pudo generar el enlace de autorización." });
  }
});

/**
 * GET /api/calendar/oauth-callback — URL FIJA (sin :slug) a la que Google
 * redirige tras el consentimiento; el tenant se recupera del `state`.
 */
calendarRouter.get("/oauth-callback", async (req: Request, res: Response) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");

  const slug = state ? consumirEstado(state) : null;
  if (!slug) {
    return res.status(401).send(paginaResultado(false, "Enlace inválido o vencido. Vuelve a pedirlo desde el dashboard."));
  }
  const tenant = obtenerTenant(slug);
  if (!tenant) {
    return res.status(404).send(paginaResultado(false, "Cliente no encontrado."));
  }
  if (!code) {
    return res.status(400).send(paginaResultado(false, "Google no envió el código de autorización."));
  }

  try {
    await manejarCallbackOAuth(tenant.id, code, obtenerRedirectUri(req));
    res.send(paginaResultado(true, "Google Calendar conectado correctamente."));
  } catch (err: any) {
    console.error("[calendar] Error en el callback de OAuth:", err);
    res.status(500).send(paginaResultado(false, err?.message ?? "No se pudo completar la conexión con Google."));
  }
});

/** POST /api/:slug/calendar/desconectar */
calendarRouter.post("/desconectar", requiereAdmin, async (req: Request, res: Response) => {
  try {
    await desconectarOAuth(req.tenant!.id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[calendar] Error desconectando:", err);
    res.status(500).json({ error: "No se pudo desconectar Google Calendar." });
  }
});

function paginaResultado(ok: boolean, mensaje: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stage Bot</title>
<style>body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:420px;text-align:center;padding:24px}</style></head>
<body><div class="card"><h1>${ok ? "Listo" : "Algo salió mal"}</h1><p>${mensaje}</p><p style="opacity:.6;font-size:14px">Puedes cerrar esta pestaña y volver al dashboard.</p></div></body></html>`;
}
