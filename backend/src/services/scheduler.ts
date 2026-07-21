import cron from "node-cron";
import { supabase } from "../lib/supabase.js";
import { config } from "../lib/config.js";
import { listarTenants, listarTenantsAsistente } from "../lib/tenants.js";
import { enviarMensajeTexto } from "./baileys.js";
import { notificarEmpleados } from "./notificaciones.js";
import { formatearReporteTexto, generarDatosReporteDiario } from "./reportes.js";
import { ejecutarTriaje } from "./asistente/triaje.js";

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

  programarTriajeAsistentes();
}

/**
 * Programa la ingesta de correo de cada bot tipo asistente. Cada tenant define
 * su propio intervalo desde el Bot Builder, así que se agrupan por intervalo
 * para no crear un cron por cliente cuando comparten la misma cadencia.
 */
function programarTriajeAsistentes(): void {
  const asistentes = listarTenantsAsistente();
  if (asistentes.length === 0) return;

  const porIntervalo = new Map<number, typeof asistentes>();
  for (const tenant of asistentes) {
    const minutos = tenant.config.asistente!.intervaloMinutos;
    porIntervalo.set(minutos, [...(porIntervalo.get(minutos) ?? []), tenant]);
  }

  for (const [minutos, tenants] of porIntervalo) {
    // node-cron no acepta "*/90": por encima de 59 minutos lo alineamos a la hora.
    const expresion = minutos >= 60 ? `0 */${Math.floor(minutos / 60)} * * *` : `*/${minutos} * * * *`;

    cron.schedule(
      expresion,
      async () => {
        // Secuencial a propósito: varios tenants triando a la vez multiplican
        // las llamadas simultáneas a Gmail y a Groq sin necesidad.
        for (const tenant of tenants) {
          try {
            const resumen = await ejecutarTriaje(tenant);
            if (resumen.revisados > 0) {
              console.log(
                `[scheduler:${tenant.config.slug}] Triaje — ${resumen.revisados} revisados, ` +
                  `${resumen.descartadosHeuristica} descartados, ${resumen.borradoresCreados} borradores, ` +
                  `${resumen.escaladosRevision} a revisión.`,
              );
            }
          } catch (err) {
            console.error(`[scheduler:${tenant.config.slug}] Error en el triaje de correo:`, err);
          }
        }
      },
      { timezone: "UTC" },
    );

    console.log(
      `[scheduler] Triaje de correo cada ${minutos} min para: ${tenants.map((t) => t.config.slug).join(", ")}`,
    );
  }
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
