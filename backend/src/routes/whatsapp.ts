import { Router, type Request, type Response } from "express";
import { requiereAdmin } from "../lib/adminAuth.js";
import { config } from "../lib/config.js";
import { obtenerEstadoWhatsApp, procesarMensajeMeta, solicitarCodigoEmparejamiento } from "../services/baileys.js";
import { marcarClienteAtendido } from "../services/clientes.js";
import { parseMetaMessages, verifyMetaChallenge, verifyMetaSignature } from "../services/meta-whatsapp.js";

export const whatsappRouter = Router({ mergeParams: true });

/** Verificación única del webhook configurado en Meta Developers. */
whatsappRouter.get("/meta-webhook", (req: Request, res: Response) => {
  if (req.tenant!.config.whatsapp.provider !== "meta_cloud") return res.sendStatus(404);
  const challenge = verifyMetaChallenge(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
  if (!challenge) return res.sendStatus(403);
  return res.status(200).send(challenge);
});

/** Eventos entrantes oficiales; la firma impide inyecciones desde terceros. */
whatsappRouter.post("/meta-webhook", (req: Request, res: Response) => {
  if (req.tenant!.config.whatsapp.provider !== "meta_cloud") return res.sendStatus(404);
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !verifyMetaSignature(rawBody, req.header("x-hub-signature-256"))) return res.sendStatus(401);
  const tenant = req.tenant!;
  const messages = parseMetaMessages(req.body);
  res.sendStatus(200);
  void Promise.allSettled(messages.map((message) => procesarMensajeMeta(tenant, message))).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.error(`[whatsapp:${tenant.config.slug}] Webhook Meta falló:`, result.reason);
    }
  });
});

function tienePlataforma(req: Request): boolean {
  return Boolean(config.plataforma.secreto) && req.header("x-platform-secret") === config.plataforma.secreto;
}

/** GET /api/:slug/whatsapp/status */
whatsappRouter.get("/status", (req: Request, res: Response) => {
  const responder = () =>
    res.json(obtenerEstadoWhatsApp(req.tenant!.id) ?? { provider: req.tenant!.config.whatsapp.provider, conectado: false, numero: null, qrDataUrl: null, pairingCode: null, actualizadoEn: 0 });

  // El Owner Console se ejecuta solo en el equipo de Stage AI Labs y usa el
  // secreto de plataforma. Así puede mostrar el QR sin tener que crear antes
  // una sesión de administrador para el cliente.
  if (tienePlataforma(req)) return responder();
  requiereAdmin(req, res, responder);
});

/** POST /api/:slug/whatsapp/solicitar-codigo — body: { numero } */
whatsappRouter.post("/solicitar-codigo", requiereAdmin, async (req: Request, res: Response) => {
  const numero = String(req.body?.numero ?? "").trim();
  if (!numero) {
    return res.status(400).json({ error: "Falta el número de teléfono." });
  }
  try {
    const codigo = await solicitarCodigoEmparejamiento(req.tenant!.id, numero);
    res.json({ codigo });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "No se pudo generar el código." });
  }
});

/** POST /api/:slug/whatsapp/clientes/:clienteId/atendido */
whatsappRouter.post("/clientes/:clienteId/atendido", requiereAdmin, async (req: Request, res: Response) => {
  const clienteId = String(req.params.clienteId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(clienteId)) {
    return res.status(400).json({ error: "Identificador de cliente inválido." });
  }

  try {
    const actualizado = await marcarClienteAtendido(clienteId);
    if (!actualizado) {
      return res.status(404).json({ error: "El cliente ya no tiene una solicitud de atención pendiente." });
    }
    res.json({ ok: true, estado: "interesado" });
  } catch (err: any) {
    console.error("[whatsapp] Error marcando cliente como atendido:", err);
    res.status(500).json({ error: "No se pudo reactivar el bot para este cliente." });
  }
});
