import type { NextFunction, Request, Response } from "express";
import { obtenerTenant, type Tenant } from "./tenants.js";

// Extiende Express para adjuntar el tenant resuelto a la petición.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

/**
 * Middleware de rutas tipo /api/:slug/... — busca el tenant por su slug y lo
 * adjunta a `req.tenant`. 404 si no existe (evita que un slug mal escrito
 * llegue a los servicios y falle de forma confusa más adelante).
 */
export function resolverTenant(req: Request, res: Response, next: NextFunction) {
  const slug = String(req.params.slug ?? "");
  const tenant = obtenerTenant(slug);
  if (!tenant) {
    return res.status(404).json({ error: `No existe un cliente con slug "${slug}".` });
  }
  req.tenant = tenant;
  next();
}
