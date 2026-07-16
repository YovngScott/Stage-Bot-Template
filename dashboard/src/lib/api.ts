import { supabase, TENANT_SLUG } from "./supabase";

const configuredApiUrl = (import.meta.env.VITE_API_URL as string) || "";

/**
 * The shared dashboard is deployed once, while every client gets its own Fly
 * app. The Owner Console adds `?api=https://stage-<tenant>-<kind>.fly.dev` to
 * the link. Restrict it to that tenant's dedicated Fly hostname so a crafted
 * URL cannot redirect authenticated dashboard requests elsewhere.
 */
function runtimeApiUrl(): string {
  if (typeof window === "undefined" || !TENANT_SLUG) return "";
  const value = new URLSearchParams(window.location.search).get("api")?.trim();
  if (!value) return "";
  try {
    const url = new URL(value);
    const expectedPrefix = `stage-${TENANT_SLUG}-`;
    const isDedicatedTenantApp = url.protocol === "https:"
      && url.hostname.endsWith(".fly.dev")
      && url.hostname.startsWith(expectedPrefix);
    return isDedicatedTenantApp ? url.origin : "";
  } catch {
    return "";
  }
}

const API_URL = runtimeApiUrl() || configuredApiUrl;

export function getApiUrl(): string {
  return API_URL;
}

/** Inicia sesión directo contra Supabase Auth (email/contraseña). */
export async function login(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    throw new Error(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message);
  }
}

export async function logout(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * fetch() hacia el backend con el access_token de Supabase en el header
 * Authorization. `path` es relativo a las rutas de ESTE tenant, ej.
 * "/auth/me" → GET {API_URL}/api/{TENANT_SLUG}/auth/me. NO cierra la sesión
 * ante un 401 (puede significar solo que el correo no está autorizado para
 * este tenant; desloguear ahí crearía un bucle entrar → 401 → salir → entrar).
 */
export async function adminFetch(path: string, opciones: RequestInit = {}): Promise<Response> {
  if (!API_URL) {
    throw new Error("Falta configurar VITE_API_URL en el .env del dashboard.");
  }
  if (!TENANT_SLUG) {
    throw new Error("Falta configurar VITE_TENANT_SLUG en el .env del dashboard.");
  }
  const { data } = await supabase.auth.getSession();
  const headers = new Headers(opciones.headers);
  if (data.session?.access_token) {
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  return fetch(`${API_URL}/api/${TENANT_SLUG}${path}`, { ...opciones, headers });
}

export type EstadoAcceso =
  | { estado: "autorizado" }
  | { estado: "sin-acceso"; mensaje: string }
  | { estado: "backend-caido"; mensaje: string };

/**
 * Comprueba contra el backend si la sesión actual está autorizada para este
 * tenant (adminEmails de su config/tenants/<slug>.json, o súper-admin).
 */
export async function verificarAcceso(): Promise<EstadoAcceso> {
  if (!API_URL || !TENANT_SLUG) {
    return { estado: "backend-caido", mensaje: "Falta configurar VITE_API_URL / VITE_TENANT_SLUG en el dashboard." };
  }
  try {
    const res = await adminFetch("/auth/me");
    if (res.ok) return { estado: "autorizado" };

    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) {
      return { estado: "sin-acceso", mensaje: data?.error ?? "Tu cuenta no tiene acceso a este panel." };
    }
    if (res.status === 404) {
      return {
        estado: "backend-caido",
        mensaje: `El backend no reconoce el cliente "${TENANT_SLUG}" (revisa que exista config/tenants/${TENANT_SLUG}.json y que el backend esté desplegado con ese archivo).`,
      };
    }
    return { estado: "backend-caido", mensaje: data?.error ?? `El backend respondió ${res.status}.` };
  } catch {
    return { estado: "backend-caido", mensaje: "No se pudo contactar al backend." };
  }
}
