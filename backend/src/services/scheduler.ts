import cron from "node-cron";
import { supabase } from "../lib/supabase.js";
import { listarTenants, listarTenantsAsistente } from "../lib/tenants.js";
import { enviarMensajeTexto } from "./baileys.js";
import { notificarEmpleados } from "./notificaciones.js";
import { formatearReporteTexto, generarDatosReporteDiario } from "./reportes.js";
import { ejecutarTriaje, responderComandoWhatsApp } from "./asistente/triaje.js";
import { localClock, shouldRunAt } from "./tenant-schedule.js";
import { pollInsuranceEmails } from "./insurance-email.js";

/**
 * Un reloj UTC por minuto evalúa la hora LOCAL de cada tenant. La reclamación
 * atómica en Supabase evita que dos Machines ejecuten el mismo trabajo.
 */
export function iniciarScheduler(): void {
  cron.schedule("* * * * *", () => void ejecutarTrabajosLocales(new Date()), { timezone: "UTC" });
  cron.schedule("* * * * *", () => {
    const tenant = listarTenants().find((item) => item.config.slug === "dominguez-auto-pintura");
    if (tenant) void pollInsuranceEmails(tenant).catch((error) => console.error("[seguros] Error de polling:", error));
  }, { timezone: "UTC" });
  void ejecutarTrabajosLocales(new Date());
  programarTriajeAsistentes();
  console.log("[scheduler] Horarios por tenant activos: zona local, días laborables, feriados y horas silenciosas.");
}

export function detenerScheduler(): void {
  for (const tarea of cron.getTasks().values()) tarea.stop();
}

async function claimScheduledJob(tenantId: string, job: string, localDate: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_scheduled_job", {
    p_tenant_id: tenantId,
    p_job: job,
    p_local_date: localDate,
  });
  if (error) throw error;
  return data === true;
}

async function finishScheduledJob(tenantId: string, job: string, localDate: string, error?: unknown) {
  await supabase
    .from("scheduled_job_runs")
    .update({
      completed_at: error ? null : new Date().toISOString(),
      error: error instanceof Error ? error.message.slice(0, 800) : error ? String(error).slice(0, 800) : null,
    })
    .eq("tenant_id", tenantId)
    .eq("job", job)
    .eq("local_date", localDate);
}

async function runOnce(
  tenantId: string,
  slug: string,
  job: string,
  localDate: string,
  task: () => Promise<void>,
) {
  if (!(await claimScheduledJob(tenantId, job, localDate))) return;
  try {
    await task();
    await finishScheduledJob(tenantId, job, localDate);
  } catch (error) {
    await finishScheduledJob(tenantId, job, localDate, error);
    console.error(`[scheduler:${slug}] ${job} falló:`, error);
  }
}

async function ejecutarTrabajosLocales(now: Date): Promise<void> {
  for (const tenant of listarTenants()) {
    const { schedule, zonaHoraria, slug, kind, asistente } = tenant.config;
    const clock = localClock(now, zonaHoraria);

    if (shouldRunAt(clock, schedule.appointmentReminderTime, schedule)) {
      await runOnce(tenant.id, slug, "appointment_reminders", clock.date, () =>
        enviarRecordatoriosCitas(tenant.id, zonaHoraria),
      );
    }

    if (shouldRunAt(clock, schedule.dailyReportTime, schedule)) {
      await runOnce(tenant.id, slug, "daily_report", clock.date, async () => {
        if (kind === "assistant" && asistente?.whatsappAlertas) {
          await enviarMensajeTexto(tenant.id, asistente.whatsappAlertas, await responderComandoWhatsApp(tenant, "estado"));
          return;
        }
        const data = await generarDatosReporteDiario(tenant);
        await notificarEmpleados(tenant.id, formatearReporteTexto(tenant, data));
      });
    }
  }
}

/** Agrupa por intervalo para no crear un timer independiente por asistente. */
function programarTriajeAsistentes(): void {
  const asistentes = listarTenantsAsistente();
  if (asistentes.length === 0) return;

  const porIntervalo = new Map<number, typeof asistentes>();
  for (const tenant of asistentes) {
    const minutos = tenant.config.asistente!.intervaloMinutos;
    porIntervalo.set(minutos, [...(porIntervalo.get(minutos) ?? []), tenant]);
  }

  for (const [minutos, tenants] of porIntervalo) {
    const expresion = minutos >= 60 ? `0 */${Math.max(1, Math.floor(minutos / 60))} * * *` : `*/${minutos} * * * *`;
    cron.schedule(
      expresion,
      async () => {
        for (const tenant of tenants) {
          try {
            const resumen = await ejecutarTriaje(tenant);
            if (resumen.revisados > 0 || resumen.reconciliados > 0) {
              console.log(
                `[scheduler:${tenant.config.slug}] Triaje — ${resumen.revisados} revisados, ` +
                  `${resumen.descartadosHeuristica} descartados, ${resumen.enviados} enviados, ` +
                  `${resumen.borradoresCreados} borradores, ${resumen.escaladosRevision} a revisión.`,
              );
            }
          } catch (error) {
            console.error(`[scheduler:${tenant.config.slug}] Error en el triaje de correo:`, error);
          }
        }
      },
      { timezone: "UTC" },
    );
  }
}

/** Envía una sola vez el recordatorio de cada cita del día siguiente local. */
async function enviarRecordatoriosCitas(tenantId: string, zonaHoraria: string): Promise<void> {
  const ahora = new Date();
  const limite = new Date(ahora.getTime() + 48 * 60 * 60_000);
  const dateKey = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: zonaHoraria, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  const mananaLocal = dateKey(new Date(ahora.getTime() + 24 * 60 * 60_000));

  const { data, error } = await supabase
    .from("citas")
    .select("inicio, motivo, clientes(nombre, telefono)")
    .eq("tenant_id", tenantId)
    .gte("inicio", ahora.toISOString())
    .lte("inicio", limite.toISOString())
    .in("estado", ["confirmada", "reprogramada"]);
  if (error) throw error;

  for (const cita of (data ?? []) as any[]) {
    if (dateKey(new Date(cita.inicio)) !== mananaLocal) continue;
    const telefono: string | undefined = cita.clientes?.telefono;
    if (!telefono) continue;
    const hora = new Intl.DateTimeFormat("es-DO", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: zonaHoraria,
    }).format(new Date(cita.inicio));
    const nombre = cita.clientes?.nombre ? ` ${cita.clientes.nombre}` : "";
    await enviarMensajeTexto(
      tenantId,
      telefono,
      `👋 Hola${nombre}, te recordamos tu cita *mañana a las ${hora}* (${cita.motivo}). ¡Te esperamos! Si necesitas reprogramar, escríbenos por este chat.`,
    );
  }
}
