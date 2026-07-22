import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase } from "./supabase.js";

/** Tipo de bot. Lo elige el Owner Console al crearlo y decide qué módulos arrancan. */
export type BotKind = "assistant" | "messaging" | "voice";

/**
 * Configuración del módulo de asistente virtual (solo aplica a kind
 * "assistant"). TODO esto lo llena el Bot Builder del Owner Console al crear
 * el bot — nunca se edita a mano ni viene con valores de un correo concreto.
 */
export interface AsistenteConfig {
  /** Correo que el asistente va a triar. Lo pide el Bot Builder al crear el bot. */
  correo: string;
  /** Número de WhatsApp (con código de país) donde el ejecutivo recibe alertas. */
  whatsappAlertas: string;
  /**
   * Red de seguridad de comprensión: por debajo de esto el asistente asume que
   * NO entendió el correo y prefiere escalarlo antes que inventar un borrador.
   * No es la barrera principal — lo que decide si algo se escala es que
   * requiera la decisión personal del titular (ver clasificador).
   */
  umbralConfianza: number;
  /** Hora local del reporte de fin de día (HH:mm). */
  horaReporte: string;
  /** Cada cuántos minutos se consulta la bandeja (consultas por lotes, sin Pub/Sub). */
  intervaloMinutos: number;
  /** Máximo de correos a procesar por corrida, para respetar la cuota de Gmail. */
  maxPorCorrida: number;
  /**
   * true  → redacta en primera persona como el titular, sin mencionar que hay
   *         un asistente de por medio. Seguro por diseño: el asistente solo
   *         crea BORRADORES (scope gmail.compose), así que nada sale sin que
   *         el titular lo lea y lo envíe él mismo.
   * false → se presenta como asistente que escribe en nombre del titular.
   * Por defecto false: identificarse es la opción conservadora.
   */
  actuaComoTitular: boolean;
  /** Nombre con el que firma cuando actuaComoTitular está activo. */
  nombreTitular: string;
  /** Taxonomía de categorías: nombre → descripción que ve el clasificador. */
  categorias: Record<string, string>;
}

/**
 * Configuración de UN cliente (tenant), cargada desde
 * config/tenants/<slug>.json. El formato se documenta en README.md.
 */
export interface TenantConfig {
  slug: string;
  kind: BotKind;
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
  /** Presente solo cuando kind === "assistant". */
  asistente: AsistenteConfig | null;
}

/** Taxonomía por defecto del triaje (la del análisis de requisitos). */
const CATEGORIAS_POR_DEFECTO: Record<string, string> = {
  Billing: "Facturas, pagos, alertas financieras, reembolsos, aprobaciones de presupuesto.",
  Support: "Errores de software, reportes de fallos, caídas del sistema, problemas de acceso a funciones.",
  Sales: "Consultas de clientes, demos, cotizaciones, renovaciones de contrato, intención de compra.",
  Legal: "Contratos, términos de servicio, acuerdos de confidencialidad, cumplimiento regulatorio.",
  Security: "Solicitudes de autorización de acceso, restablecimiento de contraseñas, alertas de actividad sospechosa.",
  General_Ops: "Administración interna, actualizaciones generales, operativa rutinaria no urgente.",
};

/** Normaliza el bloque `asistente` del JSON, aplicando defaults sensatos. */
function normalizarAsistente(raw: any): AsistenteConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const correo = String(raw.correo ?? "").trim().toLowerCase();
  // Sin correo no hay nada que triar: el bot arranca igual pero el módulo
  // queda inactivo hasta que el Owner Console lo complete.
  if (!correo) return null;

  const umbral = Number(raw.umbralConfianza);
  const intervalo = Number(raw.intervaloMinutos);
  const maximo = Number(raw.maxPorCorrida);
  const categorias =
    raw.categorias && typeof raw.categorias === "object" && Object.keys(raw.categorias).length > 0
      ? (raw.categorias as Record<string, string>)
      : CATEGORIAS_POR_DEFECTO;

  return {
    correo,
    whatsappAlertas: String(raw.whatsappAlertas ?? "").replace(/[^\d]/g, ""),
    // Bajo a propósito: la política es redactar por defecto, así que este
    // valor solo frena los correos que la IA realmente no entendió.
    umbralConfianza: Number.isFinite(umbral) && umbral > 0 && umbral <= 1 ? umbral : 0.35,
    horaReporte: /^\d{2}:\d{2}$/.test(String(raw.horaReporte)) ? String(raw.horaReporte) : "18:00",
    intervaloMinutos: Number.isFinite(intervalo) && intervalo >= 1 ? Math.min(intervalo, 1440) : 10,
    maxPorCorrida: Number.isFinite(maximo) && maximo >= 1 ? Math.min(maximo, 100) : 25,
    actuaComoTitular: raw.actuaComoTitular === true,
    nombreTitular: String(raw.nombreTitular ?? "").trim(),
    categorias,
  };
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
  const slugsPermitidos = new Set(
    (process.env.TENANT_SLUGS ?? "")
      .split(",")
      .map((slug) => slug.trim().toLowerCase())
      .filter(Boolean),
  );

  const archivos = fs
    .readdirSync(CONFIG_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    // Una app dedicada solo debe iniciar la sesión de WhatsApp de su propio
    // cliente. La app histórica puede declarar varios slugs separados por coma.
    .filter((f) => slugsPermitidos.size === 0 || slugsPermitidos.has(path.basename(f, ".json").toLowerCase()));

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
      const kind: BotKind =
        json.kind === "assistant" || json.kind === "voice" ? json.kind : "messaging";

      configs.push({
        slug: json.slug,
        kind,
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
        asistente: kind === "assistant" ? normalizarAsistente(json.asistente) : null,
      });
    } catch (err) {
      console.error(`[tenants] Error leyendo ${archivo}:`, err);
    }
  }
  return configs;
}

let tenantsCache: Map<string, Tenant> | null = null;

// Overrides de corta duración para que un apagado desde el Owner Console sea
// efectivo inmediatamente, sin esperar otra lectura de red a Supabase. Se
// sincronizan con la base en establecerBotActivo() y se usan también para
// cortar respuestas que ya estaban esperando en la cola de WhatsApp.
const estadoBotEnMemoria = new Map<string, boolean>();

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

/**
 * Tenants con el asistente virtual listo para triar (kind "assistant" y con
 * un correo ya configurado desde el Bot Builder). El scheduler solo programa
 * el polling de estos.
 */
export function listarTenantsAsistente(): Tenant[] {
  return listarTenants().filter((t) => t.config.kind === "assistant" && t.config.asistente !== null);
}

/** ¿bot_activo de este tenant? Consulta fresca a Supabase (no cacheada: la
 * apaga/prende Stage AI Labs remotamente y debe reflejarse de inmediato). */
export async function tenantBotActivo(tenantId: string): Promise<boolean> {
  const override = estadoBotEnMemoria.get(tenantId);
  if (override !== undefined) return override;

  const { data, error } = await supabase.from("tenants").select("bot_activo").eq("id", tenantId).maybeSingle();
  if (error || !data) {
    // Fallar cerrado: un error de red/credenciales nunca debe permitir que un
    // bot apagado siga contestando por WhatsApp.
    console.error(`[tenants] No se pudo leer bot_activo para ${tenantId}; se bloquean respuestas por seguridad.`, error);
    return false;
  }
  const activo = Boolean(data.bot_activo);
  estadoBotEnMemoria.set(tenantId, activo);
  return activo;
}

/** Enciende/apaga el bot de un tenant (llamado desde Stage AI Labs vía routes/config.ts). */
export async function establecerBotActivo(tenantId: string, activo: boolean): Promise<void> {
  const { error } = await supabase.from("tenants").update({ bot_activo: activo }).eq("id", tenantId);
  if (error) throw error;
  // Solo se publica después de que Supabase confirmó el cambio. Desde aquí,
  // todas las comprobaciones del worker ven el nuevo valor de inmediato.
  estadoBotEnMemoria.set(tenantId, activo);
}
