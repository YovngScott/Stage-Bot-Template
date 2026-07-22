import { getApiUrl } from "./api";
import { TENANT_SLUG } from "./supabase";

export type BotKind = "assistant" | "messaging" | "voice";

export interface Negocio {
  nombre: string;
  subtitulo: string;
  /** null hasta que /config/branding responde; el layout no debe decidir con un dato adivinado. */
  kind: BotKind | null;
}

function nombreDesdeSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * The shared local dashboard must not inherit a previous client's VITE_NEGOCIO
 * values. The URL tenant is the primary identity; environment values remain a
 * fallback only for an old dedicated build without a tenant query.
 */
export function negocioInicial(): Negocio {
  const nombrePorTenant = TENANT_SLUG ? nombreDesdeSlug(TENANT_SLUG) : "";
  return {
    nombre: nombrePorTenant || (import.meta.env.VITE_NEGOCIO_NOMBRE as string) || "Mi Negocio",
    subtitulo: "Consola del bot",
    kind: null,
  };
}

function normalizarKind(value: unknown): BotKind | null {
  return value === "assistant" || value === "messaging" || value === "voice" ? value : null;
}

/** Fetch the business name stored in the selected bot's tenant configuration. */
export async function cargarNegocio(): Promise<Negocio | null> {
  const apiUrl = getApiUrl();
  if (!apiUrl || !TENANT_SLUG) return null;

  try {
    const response = await fetch(`${apiUrl}/api/${encodeURIComponent(TENANT_SLUG)}/config/branding`);
    if (!response.ok) return null;
    const data = await response.json() as { nombre?: unknown; subtitulo?: unknown; kind?: unknown };
    const nombre = typeof data.nombre === "string" ? data.nombre.trim() : "";
    const subtitulo = typeof data.subtitulo === "string" ? data.subtitulo.trim() : "";
    return nombre ? { nombre, subtitulo: subtitulo || "Consola del bot", kind: normalizarKind(data.kind) } : null;
  } catch {
    return null;
  }
}
