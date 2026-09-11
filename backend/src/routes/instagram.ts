import { Router, type Request, type Response } from "express";
import { procesarMensajeInstagram } from "../services/instagram.js";
import {
  instagramConfigured,
  parseInstagramMessageEdits,
  parseInstagramMessages,
  resolveInstagramMessageEdit,
  summarizeInstagramWebhook,
  verifyInstagramChallenge,
  verifyInstagramSignature,
} from "../services/meta-instagram.js";

export const instagramRouter = Router({ mergeParams: true });

instagramRouter.get("/webhook", (req: Request, res: Response) => {
  const challenge = verifyInstagramChallenge(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
  if (!challenge) return res.sendStatus(403);
  return res.status(200).send(challenge);
});

instagramRouter.post("/webhook", (req: Request, res: Response) => {
  if (!instagramConfigured()) {
    console.warn("[instagram] Webhook rechazado: configuración incompleta.");
    return res.sendStatus(404);
  }
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !verifyInstagramSignature(rawBody, req.header("x-hub-signature-256"))) {
    console.warn("[instagram] Webhook rechazado: firma inválida o cuerpo crudo ausente.");
    return res.sendStatus(401);
  }
  const tenant = req.tenant!;
  const messages = parseInstagramMessages(req.body);
  const edits = parseInstagramMessageEdits(req.body);
  console.info(`[instagram:${tenant.config.slug}] Webhook válido recibido (${messages.length} mensaje(s), ${edits.length} edición(es) para recuperar).`);
  if (messages.length === 0 && edits.length === 0) {
    console.info(`[instagram:${tenant.config.slug}] Forma redactada del webhook:`, JSON.stringify(summarizeInstagramWebhook(req.body)));
  }
  res.sendStatus(200);
  const work = [
    ...messages.map((message) => procesarMensajeInstagram(tenant, message)),
    ...edits.map(async (edit) => procesarMensajeInstagram(tenant, await resolveInstagramMessageEdit(edit))),
  ];
  void Promise.allSettled(work).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.error(`[instagram:${tenant.config.slug}] Webhook Meta falló:`, result.reason);
    }
  });
});
