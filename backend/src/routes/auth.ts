import { Router, type Request, type Response } from "express";
import { requiereAdmin } from "../lib/adminAuth.js";

export const authRouter = Router({ mergeParams: true });

/**
 * GET /api/:slug/auth/me — confirma que la sesión de Supabase es válida y que
 * el correo está autorizado para ESTE tenant. El dashboard la usa como
 * "guardia" antes de mostrar el panel.
 */
authRouter.get("/me", requiereAdmin, (_req: Request, res: Response) => {
  res.json({ ok: true });
});
