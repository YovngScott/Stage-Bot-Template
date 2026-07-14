import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "./supabase.js";

/**
 * Configuración de UN cliente (tenant), cargada desde
 * config/tenants/<slug>.json. Ver config/tenants/_ejemplo.json para el
 * formato completo y comentado.
 */
export interface TenantConfig {
  slug: string;
  nombreBot: string;
  nombre: string;
  descripcion: string;
  direccion: string;
  horario: string;
  contacto: string;
  redes: string;
  servicios: string;
  moneda: string;
  zonaHoraria: string;
  adminEmails: string[];
  promptExtra: string;
  googleCalendarId: string;
}

/** Tenant ya resuelto contra la base de datos (tiene su id real de Supabase). */
export interface Tenant {
  id: string;
  config: TenantConfig;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(__dirname, "../../config/tenants");

function cargarConfigsDeDisco(): TenantConfig[] {
  if (!fs.existsSync(CONFIG_DIR)) {
    console.warn(`[tenants] No existe la carpeta de configuración: ${CONFIG_DIR}`);
    return [];
  }
  const archivos = fs
    .readdirSync(CONFIG_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  const configs: TenantConfig[] = [];
  for (const archivo of archivos) {
    try {
      const raw = fs.readFileSync(path.join(CONFIG_DIR, archivo), "utf-8");
      const json = JSON.parse(raw);
      const slugEsperado = archivo.replace(/\.json$/, "");
      if (!json.slug) json.slug = slugEsperado;
      if (json.slug !== slugEsperado) {
        console.warn(
          `[tenants] ${archivo}: el campo "slug" ("${json.slug}") no coincide con el nombre del archivo ("${slugEsperado}"). Usando el nombre del archivo.`,
        );
        json.slug = slugEsperado;
      }
      if (!json.nombre) {
        console.error(`[tenants] ${archivo}: falta el campo "nombre", se omite este tenant.`);
        continue;
      }
      configs.push({
        slug: json.slug,
        nombreBot: json.nombreBot ?? "Asistente",
        nombre: json.nombre,
        descripcion: json.descripcion ?? "",
        direccion: json.direccion ?? "",
        horario: json.horario ?? "",
        contacto: json.contacto ?? "",
        redes: json.redes ?? "",
        servicios: json.servicios ?? "",
        moneda: json.moneda ?? "USD",
        zonaHoraria: json.zonaHoraria ?? "America/Santo_Domingo",
        adminEmails: (json.adminEmails ?? []).map((e: string) => e.trim().toLowerCase()).filter(Boolean),
        promptExtra: json.promptExtra ?? "",
        googleCalendarId: json.googleCalendarId ?? "primary",
      });
    } catch (err) {
      console.error(`[tenants] Error leyendo ${archivo}:`, err);
    }
  }
  return configs;
}

let tenantsCache: Map<string, Tenant> | null = null;

/**
 * Carga los archivos de config, asegura que cada uno tenga su fila en
 * `tenants` (la crea si es la primera vez que arranca), y arma el registro en
 * memoria usado por el resto del backend. Se llama una vez al iniciar.
 */
export async function cargarTenants(): Promise<Map<string, Tenant>> {
  const configs = cargarConfigsDeDisco();
  const registro = new Map<string, Tenant>();

  for (const cfg of configs) {
    const { data: existente, error: errorBusqueda } = await supabase
      .from("tenants")
      .select("id, bot_activo")
      .eq("slug", cfg.slug)
      .maybeSingle();
    if (errorBusqueda) {
      console.error(`[tenants] Error buscando el tenant "${cfg.slug}" en Supabase:`, errorBusqueda);
      continue;
    }

    let id = existente?.id as string | undefined;
    if (!id) {
      const { data: nuevo, error: errorInsert } = await supabase
        .from("tenants")
        .insert({ slug: cfg.slug, nombre: cfg.nombre })
        .select("id")
        .single();
      if (errorInsert) {
        console.error(`[tenants] Error creando el tenant "${cfg.slug}" en Supabase:`, errorInsert);
        continue;
      }
      id = nuevo.id;
      console.log(`[tenants] Tenant nuevo registrado en Supabase: ${cfg.slug} (${id})`);
    } else {
      // Mantener el nombre visible en Supabase sincronizado con el archivo.
      await supabase.from("tenants").update({ nombre: cfg.nombre }).eq("id", id);
    }

    registro.set(cfg.slug, { id: id!, config: cfg });
  }

  tenantsCache = registro;
  return registro;
}

export function listarTenants(): Tenant[] {
  if (!tenantsCache) throw new Error("Los tenants todavía no se han cargado (llama a cargarTenants() al iniciar).");
  return Array.from(tenantsCache.values());
}

export function obtenerTenant(slug: string): Tenant | undefined {
  return tenantsCache?.get(slug);
}

/** ¿bot_activo de este tenant? Consulta fresca a Supabase (no cacheada: la
 * apaga/prende Stage AI Labs remotamente y debe reflejarse de inmediato). */
export async function tenantBotActivo(tenantId: string): Promise<boolean> {
  const { data, error } = await supabase.from("tenants").select("bot_activo").eq("id", tenantId).maybeSingle();
  if (error || !data) return true; // fallar "abierto": un error transitorio no debe silenciar el bot
  return Boolean(data.bot_activo);
}

/** Enciende/apaga el bot de un tenant (llamado desde Stage AI Labs vía routes/config.ts). */
export async function establecerBotActivo(tenantId: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from("tenants").update({ bot_activo: activo }).eq("id", tenantId);
  if (error) throw error;
}
