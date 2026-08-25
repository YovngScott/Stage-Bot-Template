import { Router, type Request, type Response } from "express";
import { requiereAdmin } from "../lib/adminAuth.js";
import {
  completeInsuranceOauth,
  createInsuranceAuthUrl,
  deleteInsuranceAccount,
  insuranceRedirectUri,
  insuranceReviewDetail,
  listInsuranceAccounts,
  listInsuranceReviews,
  pollInsuranceEmails,
  resolveInsuranceReview,
} from "../services/insurance-email.js";
import { obtenerTenant } from "../lib/tenants.js";

export const insuranceRouter = Router({ mergeParams: true });

function ensureDominguez(req: Request, res: Response) {
  if (req.tenant?.config.slug !== "dominguez-auto-pintura") {
    res.status(404).json({ error: "Automatización no disponible para este cliente." });
    return false;
  }
  return true;
}

insuranceRouter.get("/accounts", requiereAdmin, async (req, res) => {
  if (!ensureDominguez(req, res)) return;
  try { res.json({ data: await listInsuranceAccounts(req.tenant!.id) }); }
  catch (error: any) { res.status(500).json({ error: error?.message || "No se pudieron cargar las cuentas." }); }
});

insuranceRouter.post("/accounts/auth-url", requiereAdmin, async (req, res) => {
  if (!ensureDominguez(req, res)) return;
  try {
    const redirect = insuranceRedirectUri(req);
    res.json({ url: createInsuranceAuthUrl(req.tenant!, String(req.body?.label || ""), String(req.body?.email || ""), redirect) });
  } catch (error: any) { res.status(400).json({ error: error?.message || "No se pudo iniciar Google OAuth." }); }
});

insuranceRouter.delete("/accounts/:id", requiereAdmin, async (req, res) => {
  if (!ensureDominguez(req, res)) return;
  try { await deleteInsuranceAccount(req.tenant!.id, req.params.id); res.json({ ok: true }); }
  catch (error: any) { res.status(500).json({ error: error?.message || "No se pudo eliminar la cuenta." }); }
});

insuranceRouter.post("/poll", requiereAdmin, async (req, res) => {
  if (!ensureDominguez(req, res)) return;
  try { res.json(await pollInsuranceEmails(req.tenant!)); }
  catch (error: any) { res.status(500).json({ error: error?.message || "No se pudo revisar Gmail." }); }
});

insuranceRouter.get("/reviews", requiereAdmin, async (req, res) => {
  if (!ensureDominguez(req, res)) return;
  try { res.json(await listInsuranceReviews(String(req.query.status || "") || undefined)); }
  catch (error: any) { res.status(500).json({ error: error?.message || "No se pudieron cargar las revisiones." }); }
});

insuranceRouter.get("/reviews/:id", requiereAdmin, async (req, res) => {
  if (!ensureDominguez(req, res)) return;
  try { res.json(await insuranceReviewDetail(req.params.id)); }
  catch (error: any) { res.status(500).json({ error: error?.message || "No se pudo abrir la revisión." }); }
});

insuranceRouter.post("/reviews/:id/:action", requiereAdmin, async (req, res) => {
  if (!ensureDominguez(req, res)) return;
  const action = req.params.action;
  if (action !== "approve" && action !== "reject") return res.status(400).json({ error: "Acción inválida." });
  try { res.json(await resolveInsuranceReview(req.params.id, action)); }
  catch (error: any) { res.status(409).json({ error: error?.message || "No se pudo resolver la revisión." }); }
});

/** Callback fijo: no lleva :slug porque Google exige una URL exacta registrada. */
insuranceRouter.get("/oauth-callback", async (req: Request, res: Response) => {
  try {
    const result = await completeInsuranceOauth(String(req.query.state || ""), String(req.query.code || ""));
    if (!obtenerTenant(result.slug)) throw new Error("Cliente no encontrado.");
    res.type("html").send(`<html><body style="font-family:system-ui;background:#080d12;color:#fff;padding:40px"><h2>Cuenta conectada</h2><p>${result.email} ya puede leer correos de seguros.</p><script>setTimeout(()=>window.close(),1800)</script></body></html>`);
  } catch (error: any) {
    res.status(400).type("html").send(`<html><body><h2>No se pudo conectar</h2><p>${String(error?.message || error)}</p></body></html>`);
  }
});
