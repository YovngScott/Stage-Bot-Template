import { useCallback, useEffect, useState } from "react";
import {
  supabase,
  supabaseConfigurado,
  TENANT_SLUG,
  type Metricas,
  type ConsultaPorCategoria,
  type PreguntaFrecuente,
  type ClientesPorDia,
} from "@/lib/supabase";
import { obtenerTenantId, reiniciarTenantId } from "@/lib/tenant";
import { configDeCanal, type Canal } from "@/lib/canales";

export type TenantEnvStatus = {
  hasTenantSlug: boolean;
  hasSupabaseUrl: boolean;
  hasSupabaseKey: boolean;
  missing: string[];
};

export type TenantInfo = {
  slug: string;
  businessName: string;
  userEmail: string;
  systemStatus: "operational" | "degraded" | "down";
  canal: Canal;
};

export type Kpi = {
  label: string;
  value: string;
  trend: number; // percent change
  spark: number[];
};

export type Appointment = {
  id: string;
  customer: string;
  service: string;
  time: string; // ISO or friendly
};

export type InventoryAlert = {
  id: string;
  item: string;
  status: "low" | "out" | "ok";
  qty: number;
};

export type ChartPoint = { day: string; clientes: number };
export type CategoryPoint = { category: string; count: number };
export type FaqItem = { question: string; count: number };

export type Connection = {
  id: string;
  name: string;
  connected: boolean;
  meta?: string;
};

export type Employee = { id: string; name: string; phone: string };

export type ChatRequest = {
  id: string;
  customer: string;
  phone: string;
  lastMessage: string;
  waitingMin: number;
};

export type BookedChat = {
  id: string;
  customer: string;
  phone: string;
  appointmentAt: string;
  service: string;
};

export type TenantData = {
  tenant: TenantInfo;
  kpis: Kpi[];
  appointments: Appointment[];
  inventory: InventoryAlert[];
  chartClientsPerDay: ChartPoint[];
  chartCategories: CategoryPoint[];
  faqs: FaqItem[];
  connections: {
    whatsapp: Connection;
    googleCalendar: Connection;
  };
  employees: Employee[];
  pendingChats: ChatRequest[];
  bookedChats: BookedChat[];
};

export function getEnvStatus(): TenantEnvStatus {
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env ?? {};
  const hasTenantSlug = Boolean(TENANT_SLUG || env.VITE_TENANT_SLUG);
  const hasSupabaseUrl = Boolean(env.VITE_SUPABASE_URL);
  const hasSupabaseKey = Boolean(env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY);
  const missing: string[] = [];
  if (!hasTenantSlug) missing.push("VITE_TENANT_SLUG");
  if (!hasSupabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!hasSupabaseKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  return { hasTenantSlug, hasSupabaseUrl, hasSupabaseKey, missing };
}

// ---------------------------------------------------------------------------
// Helpers de formato (es-MX).
// ---------------------------------------------------------------------------
const CATEGORIA_LABEL: Record<string, string> = {
  precio: "Precios",
  disponibilidad: "Disponibilidad",
  horario_ubicacion: "Horario/Ubicación",
  cita: "Citas",
  envio: "Envíos",
  pago: "Pagos",
  garantia: "Garantía",
  otra: "Otras",
};

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function etiquetaDia(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : DIAS[d.getDay()];
}

function horaAmigable(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hoy = new Date();
  const manana = new Date(hoy);
  manana.setDate(hoy.getDate() + 1);
  const hh = d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false });
  if (d.toDateString() === hoy.toDateString()) return `Hoy ${hh}`;
  if (d.toDateString() === manana.toDateString()) return `Mañana ${hh}`;
  return `${d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" })} ${hh}`;
}

function minutosDesde(iso: string | null): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

/** Tendencia % comparando los dos últimos días de una serie. */
function tendencia(serie: number[]): number {
  if (serie.length < 2) return 0;
  const ultimo = serie[serie.length - 1];
  const previo = serie[serie.length - 2];
  if (!previo) return ultimo > 0 ? 100 : 0;
  return Math.round(((ultimo - previo) / previo) * 100);
}

const REFRESCO_MS = 30_000;

type ClienteRow = {
  id: string;
  nombre: string | null;
  telefono: string;
  notas: string | null;
  ultimo_contacto: string;
  solicito_humano_en: string | null;
};

type CitaRow = {
  id: string;
  inicio: string;
  motivo: string | null;
  clientes: { nombre: string | null; telefono: string | null } | null;
};

type ServicioRow = { id: string; nombre: string; stock: number | null };

/**
 * Carga TODO el dashboard del tenant desde el Supabase compartido (vistas +
 * tablas, scopeado por tenant_id y protegido por RLS) y lo mapea a la forma
 * `TenantData` que consume la UI. Realtime + sondeo de respaldo cada 30s.
 */
export function useTenantData() {
  const env = getEnvStatus();
  const [data, setData] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  // true cuando la carga terminó pero no se encontró el tenant / la cuenta no
  // tiene acceso — distinto de "sigue cargando", para no dejar la UI pegada
  // en el esqueleto de carga para siempre.
  const [sinAcceso, setSinAcceso] = useState(false);

  const cargar = useCallback(async () => {
    if (!supabaseConfigurado) {
      setLoading(false);
      return;
    }
    try {
      const tenantId = await obtenerTenantId();
      if (!tenantId) {
        setData(null);
        setSinAcceso(true);
        setLoading(false);
        return;
      }
      setSinAcceso(false);

      const ahoraISO = new Date().toISOString();
      const [
        tenantRes,
        metricasRes,
        categoriasRes,
        preguntasRes,
        porDiaRes,
        citasRes,
        serviciosRes,
        empleadosRes,
        humanosRes,
        userRes,
      ] = await Promise.all([
        // "canal" puede no existir todavía en instalaciones viejas (falta
        // correr la migración) — si la columna no existe, Supabase devuelve
        // error en vez de tirar la promesa entera, y abajo se usa "mensajes"
        // como valor por defecto.
        supabase.from("tenants").select("nombre, bot_activo, canal").eq("id", tenantId).maybeSingle(),
        supabase.from("v_metricas").select("*").eq("tenant_id", tenantId).maybeSingle(),
        supabase
          .from("v_consultas_por_categoria")
          .select("categoria, total")
          .eq("tenant_id", tenantId),
        supabase
          .from("v_preguntas_frecuentes")
          .select("categoria, pregunta, repeticiones")
          .eq("tenant_id", tenantId)
          .limit(6),
        supabase
          .from("v_clientes_por_dia")
          .select("dia, activos, nuevos")
          .eq("tenant_id", tenantId),
        supabase
          .from("citas")
          .select("id, inicio, motivo, clientes(nombre, telefono)")
          .eq("tenant_id", tenantId)
          .gte("inicio", ahoraISO)
          .in("estado", ["confirmada", "reprogramada"])
          .order("inicio", { ascending: true })
          .limit(8),
        supabase
          .from("servicios")
          .select("id, nombre, stock")
          .eq("tenant_id", tenantId)
          .eq("disponible", true)
          .not("stock", "is", null)
          .order("stock", { ascending: true })
          .limit(8),
        supabase
          .from("empleados")
          .select("id, nombre, telefono")
          .eq("tenant_id", tenantId)
          .order("creado_en", { ascending: true }),
        // Un cliente "necesita humano" por DOS vías: (1) lo pidió explícito y el
        // bot puso estado='requiere_humano' (pausa el bot 3h), o (2) la IA lo
        // sugirió y agregó la etiqueta 'requiere_humano' SIN pausar el bot (para
        // que el bot no se auto-silencie). El dashboard debe mostrar AMBAS, así
        // que filtramos por estado O por la etiqueta.
        supabase
          .from("clientes")
          .select("id, nombre, telefono, notas, ultimo_contacto, solicito_humano_en")
          .eq("tenant_id", tenantId)
          .or("estado.eq.requiere_humano,etiquetas.cs.{requiere_humano}")
          .order("solicito_humano_en", { ascending: true, nullsFirst: false }),
        supabase.auth.getUser(),
      ]);

      const m = (metricasRes.data ?? null) as Metricas | null;
      const porDia = ((porDiaRes.data ?? []) as ClientesPorDia[]).slice(-7);
      const activos = porDia.map((d) => d.activos);
      const nuevos = porDia.map((d) => d.nuevos);

      const canal = (tenantRes.data?.canal as Canal | undefined) ?? "mensajes";
      const canalCfg = configDeCanal(canal);

      const kpis: Kpi[] = [
        {
          label: canalCfg.kpiPrincipal,
          value: String(m?.clientes_activos_hoy ?? 0),
          trend: tendencia(activos),
          spark: activos,
        },
        {
          label: "Tasa de conversión",
          value: `${m?.tasa_conversion_pct ?? 0}%`,
          trend: 0,
          spark: [],
        },
        { label: "Citas de hoy", value: String(m?.citas_hoy ?? 0), trend: 0, spark: [] },
        {
          label: `Nuevos ${canalCfg.entidadPlural}`,
          value: String(m?.clientes_nuevos_hoy ?? 0),
          trend: tendencia(nuevos),
          spark: nuevos,
        },
      ];

      const citas = (citasRes.data ?? []) as unknown as CitaRow[];
      const appointments: Appointment[] = citas.map((c) => ({
        id: c.id,
        customer: c.clientes?.nombre ?? c.clientes?.telefono ?? "Cliente",
        service: c.motivo ?? "Cita",
        time: horaAmigable(c.inicio),
      }));
      const bookedChats: BookedChat[] = citas.map((c) => ({
        id: c.id,
        customer: c.clientes?.nombre ?? c.clientes?.telefono ?? "Cliente",
        phone: c.clientes?.telefono ?? "",
        appointmentAt: horaAmigable(c.inicio),
        service: c.motivo ?? "Cita",
      }));

      const inventory: InventoryAlert[] = ((serviciosRes.data ?? []) as ServicioRow[]).map((s) => {
        const qty = s.stock ?? 0;
        const status: InventoryAlert["status"] = qty <= 0 ? "out" : qty <= 3 ? "low" : "ok";
        return { id: s.id, item: s.nombre, status, qty };
      });

      const chartClientsPerDay: ChartPoint[] = porDia.map((d) => ({
        day: etiquetaDia(d.dia),
        clientes: d.activos,
      }));

      const chartCategories: CategoryPoint[] = (
        (categoriasRes.data ?? []) as ConsultaPorCategoria[]
      )
        .map((c) => ({ category: CATEGORIA_LABEL[c.categoria] ?? c.categoria, count: c.total }))
        .sort((a, b) => b.count - a.count);

      const faqs: FaqItem[] = ((preguntasRes.data ?? []) as PreguntaFrecuente[]).map((p) => ({
        question: p.pregunta,
        count: p.repeticiones,
      }));

      const employees: Employee[] = (
        (empleadosRes.data ?? []) as { id: string; nombre: string; telefono: string }[]
      ).map((e) => ({ id: e.id, name: e.nombre, phone: e.telefono }));

      const pendingChats: ChatRequest[] = ((humanosRes.data ?? []) as ClienteRow[]).map((c) => ({
        id: c.id,
        customer: c.nombre ?? c.telefono,
        phone: c.telefono,
        lastMessage: c.notas ?? "Solicitó hablar con una persona.",
        waitingMin: minutosDesde(c.solicito_humano_en ?? c.ultimo_contacto),
      }));

      const botActivo = tenantRes.data?.bot_activo ?? true;
      const tenant: TenantInfo = {
        slug: TENANT_SLUG,
        businessName: tenantRes.data?.nombre ?? "Tu negocio",
        userEmail: userRes.data.user?.email ?? "",
        systemStatus: botActivo ? "operational" : "down",
        canal,
      };

      setData({
        tenant,
        kpis,
        appointments,
        inventory,
        chartClientsPerDay,
        chartCategories,
        faqs,
        connections: {
          whatsapp: { id: "whatsapp", name: "WhatsApp Business", connected: false },
          googleCalendar: { id: "gcal", name: "Google Calendar", connected: false },
        },
        employees,
        pendingChats,
        bookedChats,
      });
    } catch (e) {
      console.error("[useTenantData]", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    if (!supabaseConfigurado) return;

    // Nombre de canal único por montaje: en desarrollo React monta los
    // efectos dos veces (StrictMode) y reutilizar el mismo topic "dashboard"
    // chocaba contra un canal previo que ya había hecho subscribe().
    const canal = supabase
      .channel(`dashboard-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clientes" },
        () => void cargar(),
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "citas" }, () => void cargar())
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "servicios" },
        () => void cargar(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "empleados" },
        () => void cargar(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "consultas_analiticas" },
        () => void cargar(),
      )
      .subscribe();

    // Al cambiar de cuenta (login/logout) recargamos desde cero: el acceso al
    // tenant depende de quién esté logueado, así que hay que reevaluar
    // sinAcceso y volver a pedir los datos con la sesión nueva. Sin esto, tras
    // iniciar sesión con la cuenta correcta de un cliente se quedaba mostrando
    // el estado del usuario anterior hasta el siguiente sondeo.
    const { data: authSub } = supabase.auth.onAuthStateChange(() => {
      reiniciarTenantId();
      setSinAcceso(false);
      setLoading(true);
      void cargar();
    });

    const intervalo = setInterval(() => void cargar(), REFRESCO_MS);
    return () => {
      supabase.removeChannel(canal);
      authSub.subscription.unsubscribe();
      clearInterval(intervalo);
    };
  }, [cargar]);

  return { data, loading, sinAcceso, env, recargar: cargar };
}
