import { useCallback, useEffect, useState } from "react";
import {
  supabase,
  type Metricas,
  type ServicioPreguntado,
  type PreguntaFrecuente,
  type ConsultaPorCategoria,
  type ClientesPorDia,
} from "../lib/supabase";
import { obtenerTenantId } from "../lib/tenant";

export interface DashboardData {
  metricas: Metricas | null;
  servicios: ServicioPreguntado[];
  preguntas: PreguntaFrecuente[];
  categorias: ConsultaPorCategoria[];
  clientesPorDia: ClientesPorDia[];
  clientesRequierenHumano: ClienteRequiereHumano[];
  embudo: EmbudoEstado[];
  clientesAgendados: ClienteResumen[];
  proximasCitas: CitaProxima[];
  stockBajo: ServicioStock[];
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

export interface CitaProxima {
  inicio: string;
  motivo: string;
  cliente: string;
  telefono: string | null;
}

export interface ServicioStock {
  id: string;
  nombre: string;
  categoria: string | null;
  stock: number;
}

export interface ClienteRequiereHumano {
  id: string;
  nombre: string | null;
  telefono: string;
  notas: string | null;
  ultimo_contacto: string;
  /** 'requiere_humano' = el bot está en pausa; cualquier otro = el bot sigue respondiendo. */
  estado: string;
}

export interface EmbudoEstado {
  estado: string;
  total: number;
}

export interface ClienteResumen {
  id: string;
  nombre: string | null;
  telefono: string;
  notas: string | null;
  ultimo_contacto: string;
}

const REFRESCO_MS = 30_000; // sondeo de respaldo además del canal realtime

export function useDashboardData(): DashboardData {
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [servicios, setServicios] = useState<ServicioPreguntado[]>([]);
  const [preguntas, setPreguntas] = useState<PreguntaFrecuente[]>([]);
  const [categorias, setCategorias] = useState<ConsultaPorCategoria[]>([]);
  const [clientesPorDia, setClientesPorDia] = useState<ClientesPorDia[]>([]);
  const [clientesRequierenHumano, setClientesRequierenHumano] = useState<ClienteRequiereHumano[]>([]);
  const [embudo, setEmbudo] = useState<EmbudoEstado[]>([]);
  const [clientesAgendados, setClientesAgendados] = useState<ClienteResumen[]>([]);
  const [proximasCitas, setProximasCitas] = useState<CitaProxima[]>([]);
  const [stockBajo, setStockBajo] = useState<ServicioStock[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const tenantId = await obtenerTenantId();
      if (!tenantId) throw new Error("No se pudo identificar el cliente (VITE_TENANT_SLUG).");

      const ahoraISO = new Date().toISOString();
      const [m, s, q, c, d, h, e, a, pc, sb] = await Promise.all([
        supabase.from("v_metricas").select("*").eq("tenant_id", tenantId).maybeSingle(),
        supabase.from("v_servicios_mas_preguntados").select("servicio, veces_preguntada").eq("tenant_id", tenantId).limit(8),
        supabase.from("v_preguntas_frecuentes").select("categoria, pregunta, repeticiones").eq("tenant_id", tenantId).limit(10),
        supabase.from("v_consultas_por_categoria").select("categoria, total").eq("tenant_id", tenantId),
        supabase.from("v_clientes_por_dia").select("dia, activos, nuevos").eq("tenant_id", tenantId),
        // Se filtra por `atencion_humana_pendiente`, NO por estado: un caso que
        // el bot escaló queda pendiente sin pausar la conversación, y antes
        // esos casos no aparecían aquí. `estado` viene para distinguir en la UI
        // los chats que además están en pausa.
        supabase
          .from("clientes")
          .select("id, nombre, telefono, notas, ultimo_contacto, estado")
          .eq("tenant_id", tenantId)
          .eq("atencion_humana_pendiente", true)
          .order("ultimo_contacto", { ascending: false }),
        supabase.from("v_embudo").select("estado, total").eq("tenant_id", tenantId),
        supabase
          .from("clientes")
          .select("id, nombre, telefono, notas, ultimo_contacto")
          .eq("tenant_id", tenantId)
          .eq("estado", "agendado")
          .order("ultimo_contacto", { ascending: false }),
        supabase
          .from("citas")
          .select("inicio, motivo, clientes(nombre, telefono)")
          .eq("tenant_id", tenantId)
          .gte("inicio", ahoraISO)
          .in("estado", ["confirmada", "reprogramada"])
          .order("inicio", { ascending: true })
          .limit(8),
        supabase
          .from("servicios")
          .select("id, nombre, categoria, stock")
          .eq("tenant_id", tenantId)
          .eq("disponible", true)
          .not("stock", "is", null)
          .lte("stock", 3)
          .order("stock", { ascending: true })
          .limit(100),
      ]);

      const fallo = [m, s, q, c, d, h, e, a, pc, sb].find((r) => r.error);
      if (fallo?.error) throw fallo.error;

      setMetricas(m.data as Metricas);
      setServicios((s.data ?? []) as ServicioPreguntado[]);
      setPreguntas((q.data ?? []) as PreguntaFrecuente[]);
      setCategorias((c.data ?? []) as ConsultaPorCategoria[]);
      setClientesPorDia((d.data ?? []) as ClientesPorDia[]);
      setClientesRequierenHumano((h.data ?? []) as ClienteRequiereHumano[]);
      setEmbudo((e.data ?? []) as EmbudoEstado[]);
      setClientesAgendados((a.data ?? []) as ClienteResumen[]);
      setProximasCitas(
        ((pc.data ?? []) as any[]).map((cita) => ({
          inicio: cita.inicio,
          motivo: cita.motivo,
          cliente: cita.clientes?.nombre ?? cita.clientes?.telefono ?? "Cliente",
          telefono: cita.clientes?.telefono ?? null,
        })),
      );
      setStockBajo((sb.data ?? []) as ServicioStock[]);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Error cargando datos");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();

    const canal = supabase
      .channel("dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "clientes" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "consultas_analiticas" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "citas" }, cargar)
      .on("postgres_changes", { event: "*", schema: "public", table: "servicios" }, cargar)
      .subscribe();

    const intervalo = setInterval(cargar, REFRESCO_MS);
    return () => {
      supabase.removeChannel(canal);
      clearInterval(intervalo);
    };
  }, [cargar]);

  return {
    metricas,
    servicios,
    preguntas,
    categorias,
    clientesPorDia,
    clientesRequierenHumano,
    embudo,
    clientesAgendados,
    proximasCitas,
    stockBajo,
    cargando,
    error,
    recargar: cargar,
  };
}
