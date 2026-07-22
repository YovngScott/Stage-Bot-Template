import { Router, type Request, type Response } from "express";
import { requiereAdmin } from "../lib/adminAuth.js";
import { config } from "../lib/config.js";
import { generarEstado } from "../lib/oauthState.js";
import { supabase } from "../lib/supabase.js";
import { generarUrlAutorizacion } from "../services/calendar.js";
import { obtenerClienteGmail, obtenerPerfil } from "../services/asistente/gmail.js";
import { ejecutarTriaje } from "../services/asistente/triaje.js";

/**
 * API del asistente virtual, consumida por el dashboard del cliente. Todo lo
 * que el ejecutivo necesita está aquí: conectar su Gmail, ver el triaje y
 * revisar lo que el asistente no se atrevió a responder solo.
 */
export const asistenteRouter = Router({ mergeParams: true });

// Reutilizamos el mismo callback fijo de OAuth que Calendar
// (/api/calendar/oauth-callback) y su registro compartido de `state`: al
// volver de Google, el tenant se recupera igual sin importar quién pidió el
// consentimiento.
function obtenerRedirectUri(req: Request): string {
  if (config.google.oauthRedirectUri) return config.google.oauthRedirectUri;
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${req.get("host")}/api/calendar/oauth-callback`;
}

/** Rechaza peticiones a bots que no son de tipo asistente. */
function exigirAsistente(req: Request, res: Response): boolean {
  if (req.tenant!.config.kind !== "assistant") {
    res.status(400).json({ error: "Este bot no es de tipo asistente virtual." });
    return false;
  }
  return true;
}

/** GET /api/:slug/asistente/estado — configuración + conexión de Gmail. */
asistenteRouter.get("/estado", requiereAdmin, async (req: Request, res: Response) => {
  if (!exigirAsistente(req, res)) return;
  const tenant = req.tenant!;
  const asistente = tenant.config.asistente;

  if (!asistente) {
    return res.json({
      configurado: false,
      conectado: false,
      error: "Todavía no se ha definido el correo que este asistente debe atender. Complétalo desde el Bot Builder.",
    });
  }

  const gmail = await obtenerClienteGmail(tenant.id);
  const perfil = gmail ? await obtenerPerfil(gmail) : null;

  res.json({
    configurado: true,
    conectado: Boolean(perfil),
    // Avisamos si autorizaron una cuenta distinta a la que se configuró: es un
    // error silencioso muy fácil de cometer y deja el triaje leyendo otra bandeja.
    cuentaCoincide: perfil ? perfil.email.toLowerCase() === asistente.correo : null,
    correoConfigurado: asistente.correo,
    correoConectado: perfil?.email ?? null,
    umbralConfianza: asistente.umbralConfianza,
    whatsappAlertas: asistente.whatsappAlertas,
    intervaloMinutos: asistente.intervaloMinutos,
    horaReporte: asistente.horaReporte,
    actuaComoTitular: asistente.actuaComoTitular,
    nombreTitular: asistente.nombreTitular || tenant.config.nombre,
    error: perfil ? null : 'Gmail sin conectar. Usa el botón "Conectar Gmail".',
  });
});

/** GET /api/:slug/asistente/auth-url — enlace de consentimiento con la cuenta ya preseleccionada. */
asistenteRouter.get("/auth-url", requiereAdmin, async (req: Request, res: Response) => {
  if (!exigirAsistente(req, res)) return;
  const tenant = req.tenant!;
  if (!tenant.config.asistente) {
    return res.status(400).json({ error: "Falta configurar el correo del asistente desde el Bot Builder." });
  }

  try {
    const url = generarUrlAutorizacion(generarEstado(tenant.config.slug), obtenerRedirectUri(req), {
      incluirGmail: true,
      loginHint: tenant.config.asistente.correo,
    });
    res.json({ url });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "No se pudo generar el enlace de autorización." });
  }
});

/** GET /api/:slug/asistente/metricas — resumen para las tarjetas del dashboard. */
asistenteRouter.get("/metricas", requiereAdmin, async (req: Request, res: Response) => {
  if (!exigirAsistente(req, res)) return;
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);

  try {
    const { data, error } = await supabase
      .from("asistente_correos")
      .select("resultado, filtrado_heuristica, confianza")
      .eq("tenant_id", req.tenant!.id)
      .gte("procesado_en", desde.toISOString());
    if (error) throw error;

    const filas = data ?? [];
    const conConfianza = filas.filter((f: any) => typeof f.confianza === "number");
    const confianzaPromedio = conConfianza.length
      ? conConfianza.reduce((suma: number, f: any) => suma + Number(f.confianza), 0) / conConfianza.length
      : null;

    res.json({
      triadosHoy: filas.length,
      descartadosAutomaticos: filas.filter((f: any) => f.filtrado_heuristica).length,
      borradoresCreados: filas.filter((f: any) => f.resultado === "auto").length,
      pendientesRevision: filas.filter((f: any) => f.resultado === "revision" || f.resultado === "error").length,
      confianzaPromedio: confianzaPromedio === null ? null : Number(confianzaPromedio.toFixed(3)),
    });
  } catch (err: any) {
    console.error("[asistente] Error calculando métricas:", err);
    res.status(500).json({ error: "No se pudieron calcular las métricas del asistente." });
  }
});

/** GET /api/:slug/asistente/correos?resultado=revision — bandeja de triaje. */
asistenteRouter.get("/correos", requiereAdmin, async (req: Request, res: Response) => {
  if (!exigirAsistente(req, res)) return;
  const limite = Math.min(Number(req.query.limite ?? 50) || 50, 200);
  const resultado = String(req.query.resultado ?? "").trim();

  try {
    let consulta = supabase
      .from("asistente_correos")
      .select("id, remitente, asunto, recibido_en, categoria, prioridad, confianza, justificacion, resultado, motivo_descarte, borrador_id, alerta_enviada")
      .eq("tenant_id", req.tenant!.id)
      .order("procesado_en", { ascending: false })
      .limit(limite);
    if (["auto", "revision", "omitido", "error"].includes(resultado)) {
      consulta = consulta.eq("resultado", resultado);
    }

    const { data, error } = await consulta;
    if (error) throw error;
    res.json({ correos: data ?? [] });
  } catch (err: any) {
    console.error("[asistente] Error listando correos:", err);
    res.status(500).json({ error: "No se pudieron cargar los correos triados." });
  }
});

/** POST /api/:slug/asistente/triar — corrida manual desde el dashboard. */
asistenteRouter.post("/triar", requiereAdmin, async (req: Request, res: Response) => {
  if (!exigirAsistente(req, res)) return;
  try {
    const resumen = await ejecutarTriaje(req.tenant!);
    if (resumen.error) return res.status(502).json({ error: resumen.error, resumen });
    res.json({ ok: true, resumen });
  } catch (err: any) {
    console.error("[asistente] Error en el triaje manual:", err);
    res.status(500).json({ error: err?.message ?? "No se pudo ejecutar el triaje." });
  }
});

/** GET /api/:slug/asistente/ejecuciones — historial de corridas. */
asistenteRouter.get("/ejecuciones", requiereAdmin, async (req: Request, res: Response) => {
  if (!exigirAsistente(req, res)) return;
  try {
    const { data, error } = await supabase
      .from("asistente_ejecuciones")
      .select("*")
      .eq("tenant_id", req.tenant!.id)
      .order("iniciado_en", { ascending: false })
      .limit(20);
    if (error) throw error;
    res.json({ ejecuciones: data ?? [] });
  } catch (err: any) {
    console.error("[asistente] Error listando ejecuciones:", err);
    res.status(500).json({ error: "No se pudo cargar el historial de ejecuciones." });
  }
});
