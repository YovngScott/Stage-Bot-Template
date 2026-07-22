import { supabase } from "../../lib/supabase.js";
import type { Tenant } from "../../lib/tenants.js";
import { enviarMensajeTexto } from "../baileys.js";
import { clasificarCorreo, type Clasificacion } from "./clasificador.js";
import {
  asegurarEtiqueta,
  crearBorrador,
  etiquetarCorreo,
  listarCorreosNuevos,
  obtenerClienteGmail,
  obtenerCorreo,
  type CorreoGmail,
} from "./gmail.js";
import { describirMotivo, evaluarHeuristica, extraerDireccion } from "./heuristica.js";

/**
 * Orquestador del pipeline de triaje:
 *
 *   Ingesta (Gmail) → Filtro heurístico → Clasificación IA → Confidence gate
 *                                                              ├─ >= umbral → borrador automático
 *                                                              └─ <  umbral → alerta al ejecutivo
 *
 * El umbral lo define el Owner Console al crear el bot (default 0.70). La
 * regla de oro: ante la duda, escalar a un humano — nunca responder por él.
 */

export interface ResumenCorrida {
  revisados: number;
  descartadosHeuristica: number;
  clasificados: number;
  borradoresCreados: number;
  escaladosRevision: number;
  error: string | null;
}

/** Correos ya procesados, para no gastar tokens dos veces en el mismo mensaje. */
async function filtrarYaProcesados(tenantId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("asistente_correos")
    .select("gmail_message_id")
    .eq("tenant_id", tenantId)
    .in("gmail_message_id", ids);
  if (error) throw error;

  const vistos = new Set((data ?? []).map((f: any) => f.gmail_message_id));
  return ids.filter((id) => !vistos.has(id));
}

/** Marca de tiempo del último correo procesado, para no releer la bandeja entera. */
async function obtenerUltimaMarca(tenantId: string): Promise<Date | null> {
  const { data } = await supabase
    .from("asistente_correos")
    .select("recibido_en")
    .eq("tenant_id", tenantId)
    .order("recibido_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.recibido_en ? new Date(data.recibido_en) : null;
}

function alertaWhatsApp(tenant: Tenant, correo: CorreoGmail, clasificacion: Clasificacion | null): string {
  const remitente = extraerDireccion(correo.encabezados.from);
  if (!clasificacion) {
    return [
      `⚠️ *${tenant.config.nombreBot}* — correo sin clasificar`,
      "",
      `*De:* ${remitente}`,
      `*Asunto:* ${correo.encabezados.subject}`,
      "",
      "No pude analizarlo con seguridad, así que no toqué nada. Revísalo tú en Gmail.",
    ].join("\n");
  }

  const porcentaje = Math.round(clasificacion.confianza * 100);
  return [
    `🔍 *${tenant.config.nombreBot}* — necesito tu criterio`,
    "",
    `*De:* ${remitente}`,
    `*Asunto:* ${correo.encabezados.subject}`,
    `*Categoría:* ${clasificacion.categoria} · *Prioridad:* ${clasificacion.prioridad}`,
    `*Confianza:* ${porcentaje}% (por debajo de tu umbral)`,
    "",
    `_${clasificacion.justificacion}_`,
    "",
    "No redacté borrador porque no estoy seguro. Lo dejé intacto en tu bandeja.",
  ].join("\n");
}

/**
 * Responde a un mensaje que le llegó por WhatsApp al NÚMERO DE ALERTAS del
 * asistente (no al bot de ventas: los tenants "assistant" no tienen uno). Ese
 * número es el canal privado del ejecutivo, así que aquí NUNCA corre el loop
 * de ventas/soporte con IA — solo un resumen del día bajo demanda.
 */
export async function responderComandoWhatsApp(tenant: Tenant, texto: string): Promise<string> {
  const asistente = tenant.config.asistente;
  const comando = texto.trim().toLowerCase();

  if (/^(estado|resumen|status|hoy)\b/.test(comando)) {
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    const { data, error } = await supabase
      .from("asistente_correos")
      .select("resultado")
      .eq("tenant_id", tenant.id)
      .gte("procesado_en", desde.toISOString());
    if (error) throw error;

    const filas = data ?? [];
    const borradores = filas.filter((f: any) => f.resultado === "auto").length;
    const pendientes = filas.filter((f: any) => f.resultado === "revision" || f.resultado === "error").length;

    return [
      `📊 *${tenant.config.nombreBot}* — resumen de hoy`,
      `Correos revisados: ${filas.length}`,
      `Borradores listos en Gmail: ${borradores}`,
      `Pendientes de tu criterio: ${pendientes}`,
      "",
      `Bandeja: ${asistente?.correo ?? "sin configurar"}`,
    ].join("\n");
  }

  return [
    `👋 Este número es el canal de alertas de *${tenant.config.nombreBot}*.`,
    "No mantengo conversaciones aquí — reviso tu correo y te aviso cuando necesito tu criterio.",
    "",
    "Escribe *estado* para un resumen rápido del día.",
  ].join("\n");
}

async function avisarEjecutivo(tenant: Tenant, texto: string): Promise<boolean> {
  const numero = tenant.config.asistente?.whatsappAlertas;
  if (!numero) return false;
  try {
    await enviarMensajeTexto(tenant.id, numero, texto);
    return true;
  } catch (err) {
    // Que WhatsApp esté caído no puede tumbar el triaje: el correo queda
    // igualmente registrado como "revision" y visible en el dashboard.
    console.error(`[asistente:${tenant.config.slug}] No se pudo alertar por WhatsApp:`, err);
    return false;
  }
}

/**
 * Procesa la bandeja de UN tenant. Es idempotente: los correos ya registrados
 * se saltan, así que puede correr tantas veces como haga falta.
 */
export async function ejecutarTriaje(tenant: Tenant): Promise<ResumenCorrida> {
  const asistente = tenant.config.asistente;
  const resumen: ResumenCorrida = {
    revisados: 0,
    descartadosHeuristica: 0,
    clasificados: 0,
    borradoresCreados: 0,
    escaladosRevision: 0,
    error: null,
  };

  if (!asistente) {
    resumen.error = "Este bot no tiene el asistente configurado.";
    return resumen;
  }

  const { data: ejecucion } = await supabase
    .from("asistente_ejecuciones")
    .insert({ tenant_id: tenant.id })
    .select("id")
    .maybeSingle();
  const ejecucionId = ejecucion?.id as string | undefined;

  try {
    const gmail = await obtenerClienteGmail(tenant.id);
    if (!gmail) {
      throw new Error("Gmail no está conectado. El ejecutivo debe autorizar su cuenta desde el dashboard.");
    }

    const desde = await obtenerUltimaMarca(tenant.id);
    const candidatos = await listarCorreosNuevos(gmail, desde, asistente.maxPorCorrida);
    const pendientes = await filtrarYaProcesados(tenant.id, candidatos);

    // Las etiquetas son informativas; si Gmail las rechaza seguimos igual.
    const etiquetaAuto = await asegurarEtiqueta(gmail, "Borrador listo");
    const etiquetaRevision = await asegurarEtiqueta(gmail, "Requiere revisión");

    for (const id of pendientes) {
      const correo = await obtenerCorreo(gmail, id);
      if (!correo) continue;
      resumen.revisados += 1;

      const fila: Record<string, unknown> = {
        tenant_id: tenant.id,
        gmail_message_id: correo.id,
        gmail_thread_id: correo.threadId,
        remitente: extraerDireccion(correo.encabezados.from),
        asunto: correo.encabezados.subject.slice(0, 500),
        recibido_en: correo.recibidoEn,
      };

      // ---- Capa 1: filtro determinista (sin coste) -------------------------
      const heuristica = evaluarHeuristica(correo.encabezados);
      if (!heuristica.procesar) {
        resumen.descartadosHeuristica += 1;
        await supabase.from("asistente_correos").insert({
          ...fila,
          filtrado_heuristica: true,
          motivo_descarte: describirMotivo(heuristica.motivo!),
          resultado: "omitido",
        });
        continue;
      }

      // ---- Capa 2: clasificación por IA ------------------------------------
      const clasificacion = await clasificarCorreo(tenant, asistente, correo);
      if (!clasificacion) {
        resumen.escaladosRevision += 1;
        const avisado = await avisarEjecutivo(tenant, alertaWhatsApp(tenant, correo, null));
        await supabase.from("asistente_correos").insert({ ...fila, resultado: "error", alerta_enviada: avisado });
        if (etiquetaRevision) await etiquetarCorreo(gmail, correo.id, etiquetaRevision);
        continue;
      }

      resumen.clasificados += 1;
      Object.assign(fila, {
        categoria: clasificacion.categoria,
        prioridad: clasificacion.prioridad,
        confianza: clasificacion.confianza,
        justificacion: clasificacion.justificacion,
        requiere_accion: clasificacion.requiereAccion,
      });

      // ---- Capa 3: barrera de confianza ------------------------------------
      const superaUmbral = clasificacion.confianza >= asistente.umbralConfianza;

      if (superaUmbral && clasificacion.requiereAccion && clasificacion.borrador) {
        let borradorId: string | null = null;
        try {
          borradorId = await crearBorrador(gmail, {
            threadId: correo.threadId,
            para: clasificacion.borrador.destinatario,
            asunto: clasificacion.borrador.asunto,
            cuerpo: clasificacion.borrador.cuerpo,
          });
          resumen.borradoresCreados += 1;
        } catch (err) {
          console.error(`[asistente:${tenant.config.slug}] No se pudo crear el borrador de ${correo.id}:`, err);
        }
        await supabase.from("asistente_correos").insert({ ...fila, resultado: "auto", borrador_id: borradorId });
        if (etiquetaAuto) await etiquetarCorreo(gmail, correo.id, etiquetaAuto);
        continue;
      }

      if (superaUmbral) {
        // Clasificado con confianza, pero no espera respuesta: solo se archiva
        // el registro. Nada que redactar ni que molestar al ejecutivo.
        await supabase.from("asistente_correos").insert({ ...fila, resultado: "auto" });
        continue;
      }

      // Por debajo del umbral → decide una persona.
      resumen.escaladosRevision += 1;
      const avisado = await avisarEjecutivo(tenant, alertaWhatsApp(tenant, correo, clasificacion));
      await supabase.from("asistente_correos").insert({ ...fila, resultado: "revision", alerta_enviada: avisado });
      if (etiquetaRevision) await etiquetarCorreo(gmail, correo.id, etiquetaRevision);
    }
  } catch (err: any) {
    resumen.error = err?.message ?? "Error inesperado durante el triaje.";
    console.error(`[asistente:${tenant.config.slug}] Triaje fallido:`, err);
  }

  if (ejecucionId) {
    await supabase
      .from("asistente_ejecuciones")
      .update({
        finalizado_en: new Date().toISOString(),
        revisados: resumen.revisados,
        descartados_heuristica: resumen.descartadosHeuristica,
        clasificados: resumen.clasificados,
        borradores_creados: resumen.borradoresCreados,
        escalados_revision: resumen.escaladosRevision,
        error: resumen.error,
      })
      .eq("id", ejecucionId);
  }

  return resumen;
}
