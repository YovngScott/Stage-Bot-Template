import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";
import { supabase } from "./supabase.js";

/**
 * Protege un endpoint de UN tenant (montado tras `resolverTenant`, que ya
 * adjuntó `req.tenant`) exigiendo una sesión válida de Supabase Auth. El
 * correo debe estar en `adminEmails` de ESE tenant (config/tenants/<slug>.json)
 * o tener una fila en `tenant_admins` para ESE tenant. La segunda vía es la
 * que permite al Owner Console crear, editar y revocar usuarios sin volver a
 * desplegar el bot. También puede ser un súper-admin de Stage AI Labs.
 */
export async function requiereAdmin(req: Request, res: Response, next: NextFunction) {
  const tenant = req.tenant;
  if (!tenant) {
    return res.status(500).json({ error: "resolverTenant debe ejecutarse antes de requiereAdmin." });
  }

  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "No autorizado. Inicia sesión de nuevo." });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    const email = data.user?.email?.toLowerCase();
    if (error || !data.user || !email) {
      return res.status(401).json({ error: "No autorizado. Inicia sesión de nuevo." });
    }

    if (tenant.config.adminEmails.includes(email)) return next();

    const { data: esAdminDelTenant, error: errorTenantAdmin } = await supabase
      .from("tenant_admins")
      .select("user_id")
      .eq("user_id", data.user.id)
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (errorTenantAdmin) {
      console.error("[adminAuth] Error consultando tenant_admins:", errorTenantAdmin);
      return res.status(500).json({ error: "No se pudo verificar el acceso del cliente." });
    }
    if (esAdminDelTenant) return next();

    const { data: esSuperAdmin } = await supabase
      .from("super_admins")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (esSuperAdmin) return next();

    return res.status(401).json({ error: "No autorizado. Inicia sesión de nuevo." });
  } catch (err) {
    console.error("[adminAuth] Error verificando la sesión:", err);
    res.status(500).json({ error: "No se pudo verificar la sesión." });
  }
}

/**
 * Protege endpoints llamados por OTRO sistema (el owner console de Stage AI
 * Labs encendiendo/apagando un tenant remotamente). En vez de una sesión de
 * Supabase Auth, exige un secreto compartido fijo (PLATFORM_ADMIN_SECRET),
 * enviado en el header "x-platform-secret".
 */
export function requierePlataforma(req: Request, res: Response, next: NextFunction) {
  if (!config.plataforma.secreto) {
    return res.status(500).json({ error: "El servidor no tiene PLATFORM_ADMIN_SECRET configurado." });
  }
  const recibido = req.header("x-platform-secret") ?? "";
  if (recibido !== config.plataforma.secreto) {
    return res.status(401).json({ error: "No autorizado." });
  }
  next();
}
