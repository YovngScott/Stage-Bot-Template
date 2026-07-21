import { supabase } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";

export interface CitaDelDia {
  hora: string;
  cliente: string;
  motivo: string;
}

export interface DatosReporteDiario {
  fecha: string; // YYYY-MM-DD
  clientesActivosHoy: number;
  clientesNuevosHoy: number;
  mensajesHoy: number;
  clientesRequierenHumano: number;
  citasHoy: CitaDelDia[];
  serviciosMasPreguntados: { servicio: string; veces: number }[];
}

/** Reúne las métricas del día de UN tenant para el reporte de WhatsApp / dashboard. */
export async function generarDatosReporteDiario(tenant: Tenant, fecha: Date = new Date()): Promise<DatosReporteDiario> {
  const inicioDia = new Date(fecha);
  inicioDia.setHours(0, 0, 0, 0);
  const finDia = new Date(fecha);
  finDia.setHours(23, 59, 59, 999);

  const [{ data: metricas }, { data: citas }, { data: servicios }, { count: requierenHumano }] = await Promise.all([
    supabase.from("v_metricas").select("*").eq("tenant_id", tenant.id).maybeSingle(),
    supabase
      .from("citas")
      .select("inicio, motivo, clientes(nombre, telefono)")
      .eq("tenant_id", tenant.id)
      .gte("inicio", inicioDia.toISOString())
      .lte("inicio", finDia.toISOString())
      .in("estado", ["confirmada", "reprogramada"])
      .order("inicio"),
    supabase.from("v_servicios_mas_preguntados").select("servicio, veces_preguntada").eq("tenant_id", tenant.id).limit(5),
    // Mismo criterio que el dashboard: cuenta los casos pendientes de atención,
    // estén o no con el bot en pausa.
    supabase
      .from("clientes")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("atencion_humana_pendiente", true),
  ]);

  return {
    fecha: inicioDia.toISOString().slice(0, 10),
    clientesActivosHoy: metricas?.clientes_activos_hoy ?? 0,
    clientesNuevosHoy: metricas?.clientes_nuevos_hoy ?? 0,
    mensajesHoy: metricas?.mensajes_hoy ?? 0,
    clientesRequierenHumano: requierenHumano ?? 0,
    citasHoy: ((citas ?? []) as any[]).map((c) => ({
      hora: new Intl.DateTimeFormat("es-DO", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: tenant.config.zonaHoraria,
      }).format(new Date(c.inicio)),
      cliente: c.clientes?.nombre ?? c.clientes?.telefono ?? "Cliente",
      motivo: c.motivo,
    })),
    serviciosMasPreguntados: ((servicios ?? []) as any[]).map((s) => ({ servicio: s.servicio, veces: s.veces_preguntada })),
  };
}

/** Versión en texto plano (con formato WhatsApp) del reporte diario. */
export function formatearReporteTexto(tenant: Tenant, d: DatosReporteDiario): string {
  const citasTexto = d.citasHoy.length
    ? d.citasHoy.map((c) => `  • ${c.hora} — ${c.cliente} (${c.motivo})`).join("\n")
    : "  Sin citas agendadas.";
  const serviciosTexto = d.serviciosMasPreguntados.length
    ? d.serviciosMasPreguntados.map((s) => `  • ${s.servicio}: ${s.veces}`).join("\n")
    : "  Sin datos.";

  return (
    `📊 *Reporte diario ${tenant.config.nombre} — ${d.fecha}*\n\n` +
    `Clientes activos hoy: ${d.clientesActivosHoy}\n` +
    `Clientes nuevos hoy: ${d.clientesNuevosHoy}\n` +
    `Mensajes recibidos: ${d.mensajesHoy}\n` +
    `Chats esperando un empleado: ${d.clientesRequierenHumano}\n\n` +
    `*Citas de hoy:*\n${citasTexto}\n\n` +
    `*Más preguntados:*\n${serviciosTexto}`
  );
}
