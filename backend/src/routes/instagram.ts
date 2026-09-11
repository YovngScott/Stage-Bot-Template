import { Router, type Request, type Response } from "express";
import { procesarMensajeInstagram } from "../services/instagram.js";
import { instagramConfigured, parseInstagramMessages, verifyInstagramChallenge, verifyInstagramSignature } from "../services/meta-instagram.js";

export const instagramRouter = Router({ mergeParams: true });

instagramRouter.get("/webhook", (req: Request, res: Response) => {
  const challenge = verifyInstagramChallenge(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
  if (!challenge) return res.sendStatus(403);
  return res.status(200).send(challenge);
});

instagramRouter.post("/webhook", (req: Request, res: Response) => {
  if (!instagramConfigured()) return res.sendStatus(404);
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !verifyInstagramSignature(rawBody, req.header("x-hub-signature-256"))) return res.sendStatus(401);
  const tenant = req.tenant!;
  const messages = parseInstagramMessages(req.body);
  res.sendStatus(200);
  void Promise.allSettled(messages.map((message) => procesarMensajeInstagram(tenant, message))).then((results) => {
    for (const result of results) {
      if (result.status === "rejected") console.error(`[instagram:${tenant.config.slug}] Webhook Meta falló:`, result.reason);
    }
  });
});
