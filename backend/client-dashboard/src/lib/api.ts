import { supabase, TENANT_SLUG, API_URL_FROM_LINK } from "./supabase";

const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};
const configuredApiUrl = (env.VITE_API_URL ?? "").trim();

// Tenants creados antes del Bot Builder (ej. wiltech, dominguez-auto-pintura)
// no tienen una app de Fly dedicada: comparten este único backend. El Owner
// Console puede seguir mandando ?api= apuntando aquí para esos clientes.
const SHARED_LEGACY_BACKEND_HOST = "wiltech-bot.fly.dev";

/**
 * El dashboard se despliega UNA vez. Para clientes nuevos (Bot Builder) cada
 * uno tiene su propia app en Fly y el Owner Console añade
 * `?api=https://stage-<tenant>-<kind>.fly.dev`; para clientes previos al Bot
 * Builder, el `?api=` apunta al backend compartido de arriba. Se restringe a
 * esos dos casos para que una URL manipulada no pueda redirigir las
 * peticiones autenticadas a otro lado.
 */
function runtimeApiUrl(): string {
  if (!TENANT_SLUG || !API_URL_FROM_LINK) return "";
  const value = API_URL_FROM_LINK;
  try {
    const url = new URL(value);
    const expectedPrefix = `stage-${TENANT_SLUG}-`;
    const isDedicatedTenantApp =
      url.protocol === "https:" &&
      url.hostname.endsWith(".fly.dev") &&
      url.hostname.startsWith(expectedPrefix);
    const isSharedLegacyBackend =
      url.protocol === "https:" && url.hostname === SHARED_LEGACY_BACKEND_HOST;
    return isDedicatedTenantApp || isSharedLegacyBackend ? url.origin : "";
  } catch {
    return "";
  }
}

export function getApiUrl(): string {
  return runtimeApiUrl() || configuredApiUrl;
}

/** Inicia sesión directo contra Supabase Auth (email/contraseña). */
export async function login(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(
      error.message === "Invalid login credentials"
        ? "Correo o contraseña incorrectos."
        : error.message,
    );
  }
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * fetch() hacia el backend del tenant con el access_token de Supabase en el
 * header Authorization. `path` es relativo a las rutas de ESTE tenant, ej.
 * "/whatsapp/status" → GET {API_URL}/api/{TENANT_SLUG}/whatsapp/status. NO
 * cierra la sesión ante un 401 (puede ser solo que el correo no esté
 * autorizado para este tenant; desloguear ahí crearía un bucle).
 */
export async function adminFetch(path: string, opciones: RequestInit = {}): Promise<Response> {
  const apiUrl = getApiUrl();
  if (!apiUrl) throw new Error("Falta configurar VITE_API_URL en el dashboard.");
  if (!TENANT_SLUG) throw new Error("Falta configurar VITE_TENANT_SLUG en el dashboard.");
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(opciones.headers);
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  return fetch(`${apiUrl}/api/${TENANT_SLUG}${path}`, { ...opciones, headers });
}
