import { createClient } from "@supabase/supabase-js";

/**
 * URL / ANON KEY del proyecto de Supabase COMPARTIDO (multi-cliente) — son
 * públicas por diseño (van en el bundle del navegador); el aislamiento entre
 * clientes lo hace RLS + la tabla `tenant_admins` en la base, no el secreto de
 * esta clave. Se configuran SIEMPRE por variable de entorno: a propósito NO
 * hay un valor por defecto hardcodeado, para que un cliente nuevo con el .env
 * mal configurado falle con un error claro en vez de conectarse en silencio al
 * proyecto de OTRO cliente.
 */
const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};

const URL_SUPABASE = (env.VITE_SUPABASE_URL ?? "").trim();
const ANON_KEY = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? "").trim();

// Un único build online atiende a varios clientes: el Owner Console genera,
// por cliente, un enlace con `?tenant=<slug>` (y a veces `&api=<url>`). Se
// capturan UNA sola vez aquí, al cargar el módulo — igual que hace este mismo
// archivo con TENANT_SLUG — para que sigan disponibles aunque el usuario
// navegue entre pestañas del dashboard (la navegación interna no conserva
// query params, así que leer window.location.search de nuevo en cada
// pestaña los perdía). VITE_TENANT_SLUG sigue siendo válido para builds
// dedicados y para desarrollo local.
//
// Además se guardan en sessionStorage (NO localStorage: localStorage es
// compartido entre TODAS las pestañas del mismo origen, y como el mismo
// dominio sirve a varios clientes, eso mezclaría el tenant de una pestaña
// con el de otra; sessionStorage es por pestaña). Así, al recargar la
// página (F5) sobre una ruta interna como /archivos —que ya no trae
// ?tenant= en la URL— seguimos sabiendo de qué negocio es en vez de perder
// el contexto y mostrar "esta cuenta no es de este negocio".
const STORAGE_KEY_TENANT = "stage_tenant_slug";
const STORAGE_KEY_API = "stage_api_url_from_link";

function leerOGuardarEnSesion(clave: string, valorDeUrl: string): string {
  if (typeof window === "undefined") return valorDeUrl;
  if (valorDeUrl) {
    window.sessionStorage.setItem(clave, valorDeUrl);
    return valorDeUrl;
  }
  return window.sessionStorage.getItem(clave) ?? "";
}

const urlParams =
  typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const tenantFromUrl = leerOGuardarEnSesion(STORAGE_KEY_TENANT, urlParams?.get("tenant") ?? "");
export const TENANT_SLUG = (tenantFromUrl || env.VITE_TENANT_SLUG || "").trim().toLowerCase();
export const API_URL_FROM_LINK = leerOGuardarEnSesion(
  STORAGE_KEY_API,
  urlParams?.get("api") ?? "",
).trim();

export const supabaseConfigurado = Boolean(URL_SUPABASE && ANON_KEY);

// supabase-js inicializa un cliente Realtime que necesita WebSocket. El
// servidor SSR puede correr en un runtime de Node sin WebSocket nativo, así
// que hay que proveerlo explícitamente o el cliente truena al construirse.
const wsTransport =
  typeof WebSocket !== "undefined" ? WebSocket : (class {} as unknown as typeof WebSocket);

// Cuando falta configuración usamos un proyecto imposible en lugar de cadenas
// vacías (createClient lanza con URL inválida). La UI muestra el
// EnvErrorBanner y ninguna query llega a salir.
export const supabase = createClient(
  URL_SUPABASE || "https://placeholder.supabase.co",
  ANON_KEY || "placeholder-anon-key",
  {
    auth: {
      persistSession: typeof window !== "undefined",
      autoRefreshToken: true,
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
    },
    realtime: { transport: wsTransport },
  },
);

// ---------------------------------------------------------------------------
// Tipos de las vistas/tolas del backend (proyecto de mensajería compartido).
// ---------------------------------------------------------------------------
export interface Metricas {
  clientes_activos_hoy: number;
  clientes_nuevos_hoy: number;
  clientes_nuevos_semana: number;
  citas_hoy: number;
  clientes_convertidos: number;
  clientes_totales: number;
  tasa_conversion_pct: number;
  mensajes_hoy: number;
}

export interface ConsultaPorCategoria {
  categoria: string;
  total: number;
}

export interface PreguntaFrecuente {
  categoria: string;
  pregunta: string;
  repeticiones: number;
}

export interface ClientesPorDia {
  dia: string;
  activos: number;
  nuevos: number;
}
