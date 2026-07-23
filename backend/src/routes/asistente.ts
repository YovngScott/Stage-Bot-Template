import { Router, type Request, type Response } from "express";
import { requiereAdmin } from "../lib/adminAuth.js";
import { config } from "../lib/config.js";
import { consumirEstado, generarEstado } from "../lib/oauthState.js";
import { supabase } from "../lib/supabase.js";
import { obtenerTenant } from "../lib/tenants.js";
import { generarUrlAutorizacion } from "../services/calendar.js";
import { NOMBRE_PROVEEDOR, obtenerProveedorCorreo } from "../services/asistente/proveedores/index.js";
import {
  generarUrlAutorizacionMicrosoft,
  manejarCallbackMicrosoft,
} from "../services/asistente/proveedores/microsoft.js";
import {
  guardarCredencialesImap,
  normalizarCredencialesImap,
} from "../services/asistente/proveedores/imap.js";
import { ejecutarTriaje } from "../services/asistente/triaje.js";

/**
 * API del asistente virtual, consumida por el dashboard del cliente. Todo lo
 * que el ejecutivo necesita está aquí: conectar su buzón (con el proveedor que
 * sea), ver el triaje y revisar lo que el asistente no envió por su cuenta.
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

/** Microsoft tiene su propio callback: su `code` no se canjea con Google. */
function obtenerRedirectUriMicrosoft(req: Request): string {
  if (config.microsoft.redirectUri) return config.microsoft.redirectUri;
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${req.get("host")}/api/asistente/microsoft-callback`;
}

/** Rechaza peticiones a bots que no son de tipo asistente. */
function exigirAsistente(req: Request, res: Response): boolean {
  if (req.tenant!.config.kind !== "assistant") {
    res.status(400).json({ error: "Este bot no es de tipo asistente virtual." });
    return false;
  }
  return true;
}

/** GET /api/:slug/asistente/estado — configuración + estado del buzón conectado. */
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

  const proveedor = await obtenerProveedorCorreo(tenant);
  const perfil = proveedor ? await proveedor.perfil() : null;
  // IMAP deja un socket abierto solo por comprobar el estado.
  await proveedor?.cerrar?.().catch(() => {});

  res.json({
    configurado: true,
    conectado: Boolean(perfil),
    proveedor: asistente.proveedor,
    proveedorNombre: NOMBRE_PROVEEDOR[asistente.proveedor],
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
    enviarAutomatico: asistente.enviarAutomatico,
    error: perfil ? null : `Sin conectar. Usa el botón "Conectar ${NOMBRE_PROVEEDOR[asistente.proveedor]}".`,
  });
});

/**
 * GET /api/:slug/asistente/auth-url — enlace de consentimiento con la cuenta ya
 * preseleccionada. Solo aplica a los proveedores OAuth; IMAP usa /credenciales.
 */
asistenteRouter.get("/auth-url", requiereAdmin, async (req: Request, res: Response) => {
  if (!exigirAsistente(req, res)) return;
  const asistente = req.tenant!.config.asistente;
  if (!asistente) {
    return res.status(400).json({ error: "Falta configurar el correo del asistente desde el Bot Builder." });
  }

  try {
    const estado = generarEstado(req.tenant!.config.slug);
    let url: string;

    switch (asistente.proveedor) {
      case "gmail":
        url = generarUrlAutorizacion(estado, obtenerRedirectUri(req), {
          incluirGmail: true,
          loginHint: asistente.correo,
        });
        break;
      case "microsoft":
        url = generarUrlAutorizacionMicrosoft(estado, obtenerRedirectUriMicrosoft(req), asistente.correo);
        break;
      case "imap":
        return res.status(400).json({
          error: "Un correo corporativo no se conecta con un enlace: se guardan sus credenciales de servidor.",
        });
    }

    res.json({ url });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "No se pudo generar el enlace de autorización." });
  }
});

/**
 * POST /api/:slug/asistente/credenciales — guarda las credenciales IMAP/SMTP.
 * La contraseña se cifra antes de tocar la base (lib/cripto.ts) y nunca se
 * devuelve por esta API.
 */
asistenteRouter.post("/credenciales", requiereAdmin, async (req: Request, res: Response) => {
  if (!exigirAsistente(req, res)) return;
  const asistente = req.tenant!.config.asistente;
  if (asistente?.proveedor !== "imap") {
    return res.status(400).json({ error: "Este asistente no está configurado para un correo por IMAP." });
  }

  const credenciales = normalizarCredencialesImap(req.body);
  if (!credenciales) {
    return res.status(400).json({ error: "Faltan datos: servidor, usuario y contraseña son obligatorios." });
  }

  try {
    await guardarCredencialesImap(req.tenant!.id, credenciales);
    // Se prueba de inmediato: mejor fallar aquí que en la primera corrida.
    const proveedor = await obtenerProveedorCorreo(req.tenant!);
    const perfil = proveedor ? await proveedor.perfil() : null;
    await proveedor?.cerrar?.().catch(() => {});

    if (!perfil) {
      return res.status(400).json({
        error: "Se guardaron las credenciales, pero no se pudo iniciar sesión en el servidor. Revisa host, puerto y contraseña.",
      });
    }
    res.json({ ok: true, correoConectado: perfil.email });
  } catch (err: any) {
    console.error("[asistente] Error guardando credenciales IMAP:", err);
    res.status(500).json({ error: err?.message ?? "No se pudieron guardar las credenciales." });
  }
});

/**
 * GET /api/asistente/microsoft-callback — URL FIJA (sin :slug) a la que
 * Microsoft redirige tras el consentimiento; el tenant sale del `state`, igual
 * que en el flujo de Google.
 */
asistenteRouter.get("/microsoft-callback", async (req: Request, res: Response) => {
  const code = String(req.query.code ?? "");
  const state = String(req.query.state ?? "");

  const slug = state ? consumirEstado(state) : null;
  if (!slug) {
    return res.status(401).send(paginaResultado(false, "Enlace inválido o vencido. Vuelve a pedirlo desde el dashboard."));
  }
  const tenant = obtenerTenant(slug);
  if (!tenant) return res.status(404).send(paginaResultado(false, "Cliente no encontrado."));
  if (!code) return res.status(400).send(paginaResultado(false, "Microsoft no envió el código de autorización."));

  try {
    await manejarCallbackMicrosoft(tenant.id, code, obtenerRedirectUriMicrosoft(req));
    res.send(paginaResultado(true, "Cuenta de Microsoft conectada correctamente."));
  } catch (err: any) {
    console.error("[asistente] Error en el callback de Microsoft:", err);
    res.status(500).send(paginaResultado(false, err?.message ?? "No se pudo completar la conexión."));
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
      enviadosSolos: filas.filter((f: any) => f.resultado === "enviado").length,
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

/** Página simple que ve el usuario al volver del consentimiento del proveedor. */
function paginaResultado(ok: boolean, mensaje: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Stage Bot</title>
<style>body{font-family:system-ui,sans-serif;background:#0d0d0d;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{max-width:420px;text-align:center;padding:24px}</style></head>
<body><div class="card"><h1>${ok ? "Listo" : "Algo salió mal"}</h1><p>${mensaje}</p><p style="opacity:.6;font-size:14px">Puedes cerrar esta pestaña y volver al dashboard.</p></div></body></html>`;
}
