import { createClient } from "@supabase/supabase-js";

/**
 * URL/ANON KEY del proyecto de Supabase COMPARTIDO (multi-cliente) — son
 * públicas por diseño (van en el bundle del navegador); el aislamiento entre
 * clientes lo hace RLS + tenant_admins en la base, no el secreto de esta
 * clave. Deben configurarse SIEMPRE por variable de entorno: a propósito NO
 * hay un valor por defecto hardcodeado aquí, para que un cliente nuevo con
 * el .env mal configurado falle con un error claro en vez de conectarse en
 * silencio al proyecto de OTRO cliente.
 */
const URL_SUPABASE = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
export const TENANT_SLUG = (import.meta.env.VITE_TENANT_SLUG as string) || "";

if (!URL_SUPABASE || !ANON_KEY) {
  console.error(
    "[supabase] Falta VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Configúralas en el .env de este dashboard (ver .env.example).",
  );
}
if (!TENANT_SLUG) {
  console.error(
    "[supabase] Falta VITE_TENANT_SLUG. Este dashboard necesita saber a qué cliente pertenece (ver .env.example).",
  );
}

export const supabase = createClient(URL_SUPABASE, ANON_KEY);

export interface Metricas {
  clientes_activos_hoy: number;
  clientes_nuevos_hoy: number;
  clientes_nuevos_semana: number;
  clientes_nuevos_mes: number;
  citas_hoy: number;
  clientes_convertidos: number;
  clientes_totales: number;
  tasa_conversion_pct: number;
  mensajes_hoy: number;
}

export interface ServicioPreguntado {
  servicio: string;
  veces_preguntada: number;
}

export interface PreguntaFrecuente {
  categoria: string;
  pregunta: string;
  repeticiones: number;
}

export interface ConsultaPorCategoria {
  categoria: string;
  total: number;
}

export interface ClientesPorDia {
  dia: string;
  activos: number;
  nuevos: number;
}
