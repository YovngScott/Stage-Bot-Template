import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

/**
 * Cliente de Supabase con service_role key: acceso total (bypassa RLS), solo
 * backend. El proyecto es compartido por TODOS los tenants — cada consulta
 * debe filtrar por tenant_id explícitamente (el backend es el único que
 * puede saltarse el aislamiento de RLS, así que la disciplina de filtrar
 * corresponde al código, no a la base de datos).
 */
export const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

export type EstadoCliente =
  | "nuevo"
  | "interesado"
  | "cotizado"
  | "agendado"
  | "cliente"
  | "perdido"
  | "requiere_humano";

export interface Cliente {
  id: string;
  tenant_id: string;
  telefono: string;
  nombre: string | null;
  estado: EstadoCliente;
  etiquetas: string[];
  notas: string | null;
  solicito_humano_en: string | null;
  atendido_en: string | null;
}

export interface Mensaje {
  id: string;
  tenant_id: string;
  cliente_id: string;
  rol: "cliente" | "bot" | "humano" | "sistema";
  contenido: string;
  creado_en: string;
}
