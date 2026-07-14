import { supabase, TENANT_SLUG } from "./supabase";

let tenantIdPromise: Promise<string | null> | null = null;

/**
 * Resuelve el tenant_id (uuid) de este dashboard a partir de VITE_TENANT_SLUG.
 * Se cachea en memoria durante la sesión del navegador — el slug no cambia
 * sin un redeploy. Todas las consultas del dashboard deben filtrar por este
 * id: el proyecto de Supabase es COMPARTIDO por todos los clientes, y RLS
 * (tabla tenant_admins) es la barrera real, pero el dashboard igual debe
 * pedir solo lo suyo en vez de depender ciegamente de eso.
 */
export function obtenerTenantId(): Promise<string | null> {
  if (!tenantIdPromise) {
    tenantIdPromise = (async () => {
      if (!TENANT_SLUG) return null;
      const { data, error } = await supabase.from("tenants").select("id").eq("slug", TENANT_SLUG).maybeSingle();
      if (error || !data) {
        console.error(`[tenant] No se pudo resolver el tenant "${TENANT_SLUG}":`, error);
        return null;
      }
      return data.id as string;
    })();
  }
  return tenantIdPromise;
}
