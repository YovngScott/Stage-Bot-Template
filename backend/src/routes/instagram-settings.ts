import { Router } from "express";
import { z } from "zod";
import { requiereAdmin } from "../lib/adminAuth.js";
import { cifrar, cifradoDisponible } from "../lib/cripto.js";
import { supabase } from "../lib/supabase.js";
import { instagramRulesSchema } from "../services/instagram-rules.js";
import { getInstagramConnection } from "../services/instagram-connections.js";

export const instagramSettingsRouter = Router({ mergeParams: true });
instagramSettingsRouter.use(requiereAdmin);
instagramSettingsRouter.get("/connection", async (req, res) => {
  const { data, error } = await supabase.from("instagram_connections").select("account_id,username,provider,enabled,updated_at").eq("tenant_id", req.tenant!.id).maybeSingle();
  if (error) return res.status(503).json({ error: "No se pudo consultar la conexión." });
  let legacyConnected = false;
  if (!data) { try { legacyConnected = Boolean(await getInstagramConnection(req.tenant!)); } catch { return res.sendStatus(503); } }
  return res.json({ connection: data, legacyConnected, appId: process.env.META_APP_ID ?? null, facebookReady: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && cifradoDisponible()) });
});
// The Facebook SDK supplies a short-lived user token after the customer's
// consent. Resolve the Page on Meta; never trust a client-supplied Page token.
instagramSettingsRouter.post("/connection", async (req, res) => {
  const input = z.object({ accessToken: z.string().min(20).max(4096), pageId: z.string().regex(/^\d+$/) }).strict().safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "Selecciona una página autorizada." });
  if (!cifradoDisponible() || !process.env.META_APP_ID || !process.env.META_APP_SECRET) return res.status(503).json({ error: "La conexión con Facebook todavía no está habilitada." });
  try {
    const tokenCheck = new URL("https://graph.facebook.com/v26.0/debug_token");
    tokenCheck.searchParams.set("input_token", input.data.accessToken);
    const check = await fetch(tokenCheck, { headers: { authorization: `Bearer ${process.env.META_APP_ID}|${process.env.META_APP_SECRET}` }, signal: AbortSignal.timeout(10_000) });
    const validated = await check.json() as { data?: { is_valid?: boolean; app_id?: string } };
    if (!check.ok || !validated.data?.is_valid || validated.data.app_id !== process.env.META_APP_ID) return res.status(403).json({ error: "Vuelve a autorizar Facebook desde Stage." });
    const pagesResponse = await fetch("https://graph.facebook.com/v26.0/me/accounts?fields=id,access_token,instagram_business_account{id,username}&limit=100", {
      headers: { authorization: `Bearer ${input.data.accessToken}` }, signal: AbortSignal.timeout(10_000),
    });
    const pages = await pagesResponse.json() as { data?: { id: string; access_token: string; instagram_business_account?: { id: string; username?: string } }[] };
    const page = pages.data?.find(item => item.id === input.data.pageId);
    if (!pagesResponse.ok || !page?.access_token || !page.instagram_business_account) return res.status(403).json({ error: "Esa página no tiene una cuenta profesional de Instagram autorizada." });
    const account = page.instagram_business_account;
    const { data: existing, error: lookupError } = await supabase.from("instagram_connections").select("tenant_id").eq("account_id", account.id).maybeSingle();
    if (lookupError) throw new Error("lookup");
    if (existing && existing.tenant_id !== req.tenant!.id) return res.status(409).json({ error: "Esta cuenta ya está conectada a otro negocio." });
    const subscription = await fetch(`https://graph.facebook.com/v26.0/${page.id}/subscribed_apps`, {
      method: "POST", headers: { authorization: `Bearer ${page.access_token}`, "content-type": "application/json" },
      body: JSON.stringify({ subscribed_fields: "messages,messaging_postbacks" }), signal: AbortSignal.timeout(10_000),
    });
    const subscribed = await subscription.json() as { success?: boolean };
    if (!subscription.ok || !subscribed.success) return res.status(403).json({ error: "Meta no autorizó la recepción de mensajes. Revisa los permisos de la página." });
    const appName = process.env.FLY_APP_NAME ?? "";
    if (!/^[a-z0-9-]+$/.test(appName)) throw new Error("backend_origin_missing");
    const { error } = await supabase.from("instagram_connections").upsert({ tenant_id: req.tenant!.id, account_id: account.id, page_id: page.id, backend_origin: `https://${appName}.fly.dev`,
      username: account.username ?? "", token_ciphertext: cifrar(page.access_token), provider: "facebook", enabled: true, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
    if (error) throw new Error("save");
    return res.json({ connected: true, username: account.username });
  } catch { return res.status(502).json({ error: "No se pudo completar la conexión. Inténtalo nuevamente." }); }
});
instagramSettingsRouter.patch("/connection", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") return res.sendStatus(400);
  const { error } = await supabase.from("instagram_connections").update({ enabled: req.body.enabled }).eq("tenant_id", req.tenant!.id);
  return error ? res.sendStatus(503) : res.json({ ok: true });
});
instagramSettingsRouter.get("/rules", async (req, res) => {
  const { data, error } = await supabase.from("instagram_rules").select("rules").eq("tenant_id", req.tenant!.id).maybeSingle();
  return error ? res.sendStatus(503) : res.json({ rules: data?.rules ?? [] });
});
instagramSettingsRouter.put("/rules", async (req, res) => {
  const rules = instagramRulesSchema.safeParse(req.body?.rules);
  if (!rules.success) return res.status(400).json({ error: "Revisa las palabras y respuestas de tus automatizaciones." });
  const { error } = await supabase.from("instagram_rules").upsert({ tenant_id: req.tenant!.id, rules: rules.data, updated_at: new Date().toISOString() });
  return error ? res.sendStatus(503) : res.json({ ok: true });
});
