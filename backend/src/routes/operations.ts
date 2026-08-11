import { Router, type Request, type Response } from "express";
import { requierePlataforma } from "../lib/adminAuth.js";
import { obtenerEstadoWhatsApp } from "../services/baileys.js";
import { obtenerProveedorCorreo } from "../services/asistente/proveedores/index.js";
import { ejecutarTriaje } from "../services/asistente/triaje.js";
import {
  beginRetry,
  createWorkerId,
  finishRetry,
  operationStatus,
  requeueFailure,
  resolveFailure,
} from "../services/operations.js";

export const operationsRouter = Router();

operationsRouter.get("/status", requierePlataforma, async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const email = { configured: tenant.config.kind === "assistant", connected: false, error: null as string | null };
  if (tenant.config.kind === "assistant") {
    try {
      const provider = await obtenerProveedorCorreo(tenant);
      const profile = provider ? await provider.perfil() : null;
      email.connected = Boolean(profile);
      email.error = profile ? null : "OAuth o credenciales de correo no disponibles.";
      await provider?.cerrar?.().catch(() => undefined);
    } catch (error) {
      email.error = error instanceof Error ? error.message : "No se pudo validar el correo.";
    }
  }
  return res.json({
    ok: true,
    whatsapp: obtenerEstadoWhatsApp(tenant.id),
    email,
    ...(await operationStatus(tenant.config.slug)),
    checkedAt: new Date().toISOString(),
  });
});

operationsRouter.post("/failures/:id/retry", requierePlataforma, async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const reset = await requeueFailure(tenant.config.slug, req.params.id);
  if (!reset) return res.status(404).json({ error: "Fallo no encontrado." });

  const workerId = createWorkerId("manual");
  const failure = await beginRetry(tenant.config.slug, req.params.id, workerId);
  if (!failure) return res.status(409).json({ error: "Otro worker ya está procesando este fallo." });
  try {
    if (failure.source === "email" || failure.source === "oauth") {
      const result = await ejecutarTriaje(tenant);
      if (result.error) throw new Error(result.error);
    } else {
      const state = obtenerEstadoWhatsApp(tenant.id);
      if (!state?.conectado) throw new Error("WhatsApp continúa desconectado; vuelve a vincularlo.");
    }
    await finishRetry(failure.id, workerId, true);
    return res.json({ ok: true });
  } catch (error) {
    const updated = await finishRetry(failure.id, workerId, false, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "El reintento falló.", failure: updated });
  }
});

operationsRouter.post("/failures/:id/resolve", requierePlataforma, async (req: Request, res: Response) => {
  const failure = await resolveFailure(req.tenant!.config.slug, req.params.id);
  if (!failure) return res.status(404).json({ error: "Fallo no encontrado." });
  return res.json({ ok: true, failure });
});
