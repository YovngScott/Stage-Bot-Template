import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { listarTenants } from "../lib/tenants.js";
import { getInstagramConnection } from "../services/instagram-connections.js";
import { instagramContext } from "../services/instagram-context.js";
import { parseInstagramMessages, verifyInstagramSignature, verifyInstagramChallenge } from "../services/meta-instagram.js";
import { procesarMensajeInstagram } from "../services/instagram.js";

export const instagramSharedRouter = Router();
instagramSharedRouter.get("/webhook", (req, res) => {
  const challenge = verifyInstagramChallenge(req.query["hub.mode"], req.query["hub.verify_token"], req.query["hub.challenge"]);
  return challenge ? res.status(200).send(challenge) : res.sendStatus(403);
});
instagramSharedRouter.post("/webhook", async (req, res) => {
  const rawBody = (req as typeof req & { rawBody?: Buffer }).rawBody;
  if (!rawBody || !process.env.META_APP_SECRET || !verifyInstagramSignature(rawBody, req.header("x-hub-signature-256"), process.env.META_APP_SECRET)) return res.sendStatus(401);
  const messages = parseInstagramMessages(req.body);
  try {
    const targets = new Map<string, { tenant: ReturnType<typeof listarTenants>[number]; connection: NonNullable<Awaited<ReturnType<typeof getInstagramConnection>>> }>();
    const forwarded = new Set<string>();
    for (const recipient of new Set(messages.map(message => message.recipientId))) {
      const { data, error } = await supabase.from("instagram_connections").select("tenant_id,backend_origin").eq("account_id", recipient).eq("enabled", true).maybeSingle();
      if (error) return res.sendStatus(503);
      const tenant = listarTenants().find(item => item.id === data?.tenant_id);
      if (!tenant) {
        if (!data || forwarded.has(data.tenant_id)) continue;
        const { data: remote, error: tenantError } = await supabase.from("tenants").select("slug").eq("id", data.tenant_id).single();
        if (tenantError || !/^https:\/\/[a-z0-9-]+\.fly\.dev$/.test(data.backend_origin)) return res.sendStatus(503);
        const delivered = await fetch(`${data.backend_origin}/api/${encodeURIComponent(remote.slug)}/instagram/webhook`, {
          method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": req.header("x-hub-signature-256")! },
          body: new Uint8Array(rawBody).buffer, redirect: "error", signal: AbortSignal.timeout(10_000),
        });
        if (!delivered.ok) return res.sendStatus(503);
        forwarded.add(data.tenant_id);
        continue;
      }
      const connection = await getInstagramConnection(tenant);
      if (connection) targets.set(recipient, { tenant, connection });
    }
    res.sendStatus(200);
    await Promise.allSettled(messages.map(async message => {
      const target = targets.get(message.recipientId);
      if (!target) return;
      return instagramContext.run(target.connection, () => procesarMensajeInstagram(target.tenant, message));
    })).then(results => { for (const result of results) if (result.status === "rejected") console.error("[instagram] No se pudo procesar un mensaje del buzón conectado."); });
  } catch { if (!res.headersSent) res.sendStatus(503); }
});
