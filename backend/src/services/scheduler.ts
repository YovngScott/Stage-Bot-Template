import cron from "node-cron";
import { supabase } from "../lib/supabase.js";
import { config } from "../lib/config.js";
import { listarTenants } from "../lib/tenants.js";
import { enviarMensajeTexto } from "./baileys.js";
import { notificarEmpleados } from "./notificaciones.js";
import { formatearReporteTexto, generarDatosReporteDiario } from "./reportes.js";

function horaACronDiario(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  return `${m} ${h} * * *`;
}

/**
 * Arranca los cron jobs del bot para TODOS los tenants: recordatorio de citas
 * y reporte diario. Misma hora global para todos (simplicidad); cada tenant
 * recibe su recordatorio/reporte en SU propia zona horaria.
 */
export function iniciarScheduler(): void {
  cron.schedule(
    horaACronDiario(config.reportes.horaRecordatorioCitas),
    () => {
      for (const tenant of listarTenants()) {
        enviarRecordatoriosCitas(tenant.id, tenant.config.zonaHoraria).catch((err) =>
          console.error(`[scheduler:${tenant.config.slug}] Error enviando recordatorios de citas:`, err),
        );
      }
    },
    { timezone: "UTC" },
  );

  cron.schedule(
    horaACronDiario(config.reportes.horaReporteDiario),
    async () => {
      for (const tenant of listarTenants()) {
        try {
          const datos = await generarDatosReporteDiario(tenant);
          await notificarEmpleados(tenant.id, formatearReporteTexto(tenant, datos));
        } catch (err) {
          console.error(`[scheduler:${tenant.config.slug}] Error enviando el reporte diario:`, err);
        }
      }
    },
    { timezone: "UTC" },
  );

  console.log(
    `[scheduler] Recordatorio de citas: ${config.reportes.horaRecordatorioCitas} UTC · Reporte diario: ${config.reportes.horaReporteDiario} UTC (para todos los tenants)`,
  );
}

/** Le escribe a cada cliente de un tenant con cita mañana, recordándole la hora. */
async function enviarRecordatoriosCitas(tenantId: string, zonaHoraria: string): Promise<void> {
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  const inicio = new Date(manana);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(manana);
  fin.setHours(23, 59, 59, 999);

  const { data, error } = await supabase
    .from("citas")
    .select("inicio, motivo, clientes(nombre, telefono)")
    .eq("tenant_id", tenantId)
    .gte("inicio", inicio.toISOString())
    .lte("inicio", fin.toISOString())
    .in("estado", ["confirmada", "reprogramada"]);
  if (error) throw error;

  for (const cita of (data ?? []) as any[]) {
    const telefono: string | undefined = cita.clientes?.telefono;
    if (!telefono) continue;

    const hora = new Intl.DateTimeFormat("es-DO", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zonaHoraria,
    }).format(new Date(cita.inicio));

    const nombre = cita.clientes?.nombre ? ` ${cita.clientes.nombre}` : "";
    const texto = `👋 Hola${nombre}, te recordamos tu cita *mañana a las ${hora}* (${cita.motivo}). ¡Te esperamos! Si necesitas reprogramar, escríbenos por este mismo chat.`;

    await enviarMensajeTexto(tenantId, telefono, texto).catch((err) =>
      console.error(`[scheduler] Error recordando cita a ${telefono}:`, err),
    );
  }
}
