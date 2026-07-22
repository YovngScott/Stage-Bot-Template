import { Router, type Request, type Response } from "express";
import { config } from "../lib/config.js";
import { requiereAdmin } from "../lib/adminAuth.js";
import { tenantBotActivo, establecerBotActivo } from "../lib/tenants.js";
import { desconectarWhatsApp, iniciarWhatsApp } from "../services/baileys.js";

export const configRouter = Router({ mergeParams: true });

function tienePlataforma(req: Request): boolean {
  return Boolean(config.plataforma.secreto) && req.header("x-platform-secret") === config.plataforma.secreto;
}

/**
 * Identidad pública mínima para el dashboard compartido. No expone secretos,
 * prompts ni correos; solo evita que una marca fijada en un build antiguo se
 * muestre al abrir otro tenant mediante ?tenant=<slug>.
 */
configRouter.get("/branding", (req: Request, res: Response) => {
  const tenant = req.tenant!;
  res.json({
    slug: tenant.config.slug,
    nombre: tenant.config.nombre,
    nombreBot: tenant.config.nombreBot,
    subtitulo: "Consola del bot",
    // El dashboard usa esto para decidir qué navegación mostrar: un bot
    // "assistant" no tiene funnel de ventas ni catálogo que exhibir.
    kind: tenant.config.kind,
  });
});

/**
 * GET /api/:slug/config/bot-activo — estado actual del interruptor del bot
 * de este tenant. Acepta el secreto de plataforma (Stage AI Labs consultando
 * antes de mostrar el switch) o una sesión de admin de este tenant.
 */
configRouter.get("/bot-activo", async (req: Request, res: Response) => {
  if (tienePlataforma(req)) {
    return res.json({ activo: await tenantBotActivo(req.tenant!.id) });
  }
  requiereAdmin(req, res, async () => {
    res.json({ activo: await tenantBotActivo(req.tenant!.id) });
  });
});

/**
 * POST /api/:slug/config/bot-activo — enciende/apaga el bot de este tenant.
 * Body: { activo: boolean }. Llamado desde el owner console de Stage AI Labs
 * (secreto de plataforma).
 */
configRouter.post("/bot-activo", async (req: Request, res: Response) => {
  if (!tienePlataforma(req)) {
    return res.status(401).json({ error: "No autorizado." });
  }
  const activo = Boolean(req.body?.activo);
  try {
    await establecerBotActivo(req.tenant!.id, activo);
    // Tras una baja la sesión se eliminó deliberadamente. Al reactivar se
    // inicia una sesión limpia para que Owner Console pueda mostrar un QR.
    if (activo) await iniciarWhatsApp(req.tenant!);
    res.json({ ok: true, activo });
  } catch (err) {
    console.error("[config] Error actualizando bot_activo:", err);
    res.status(500).json({ error: "No se pudo actualizar el estado del bot." });
  }
});

/**
 * POST /api/:slug/config/decommission
 * Baja operativa desde Owner Console: detiene las respuestas inmediatamente,
 * invalida la sesión de WhatsApp y borra sus credenciales del volumen. No
 * borra el tenant ni sus datos; volver a activarlo requerirá escanear un QR.
 */
configRouter.post("/decommission", async (req: Request, res: Response) => {
  if (!tienePlataforma(req)) {
    return res.status(401).json({ error: "No autorizado." });
  }
  try {
    const tenant = req.tenant!;
    await establecerBotActivo(tenant.id, false);
    await desconectarWhatsApp(tenant);
    res.json({ ok: true, activo: false, whatsappDesconectado: true });
  } catch (err) {
    console.error("[config] Error dando de baja el bot:", err);
    res.status(500).json({ error: "No se pudo desconectar WhatsApp y dar de baja el bot." });
  }
});
