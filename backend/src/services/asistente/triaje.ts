import { supabase } from "../../lib/supabase.js";
import type { Tenant } from "../../lib/tenants.js";
import { enviarMensajeTexto } from "../baileys.js";
import { clasificarCorreo, type Clasificacion } from "./clasificador.js";
import { obtenerProveedorCorreo, type CorreoEntrante, type EmailProvider } from "./proveedores/index.js";
import { envioAutomaticoActivo } from "../../lib/tenants.js";
import { describirMotivo, evaluarHeuristica, extraerDireccion } from "./heuristica.js";
import { validarParaEnvio } from "./validacion.js";
import { construirDestinoSeguro } from "./seguridad.js";

/**
 * Orquestador del pipeline de triaje:
 *
 *   Ingesta → Filtro heurístico → Clasificación IA → ¿enviar o dejar borrador?
 *                                                     ├─ rutinario → se responde y se ENVÍA
 *                                                     └─ crítico o ambiguo → borrador + alerta
 *
 * Trabaja contra la interfaz EmailProvider, así que funciona igual con Gmail,
 * Microsoft o un correo corporativo por IMAP. La regla de oro: ante la duda,
 * decide el titular — nunca se envía por él.
 */

export interface ResumenCorrida {
  revisados: number;
  descartadosHeuristica: number;
  clasificados: number;
  /** Rutinarios respondidos y enviados sin intervención. */
  enviados: number;
  /** Borradores que el titular ya resolvió en su buzón y salen de pendientes. */
  reconciliados: number;
  borradoresCreados: number;
  escaladosRevision: number;
  error: string | null;
}

const triajesEnCurso = new Map<string, Promise<ResumenCorrida>>();

/**
 * Nunca ejecuta dos corridas simultáneas para el mismo tenant. El scheduler,
 * el botón manual y una petición repetida comparten la misma promesa, evitando
 * respuestas/borradores duplicados antes de que actúe el UNIQUE de la base.
 */
export function ejecutarTriaje(tenant: Tenant): Promise<ResumenCorrida> {
  const existente = triajesEnCurso.get(tenant.id);
  if (existente) return existente;
  const corrida = ejecutarTriajeInterno(tenant).finally(() => {
    if (triajesEnCurso.get(tenant.id) === corrida) triajesEnCurso.delete(tenant.id);
  });
  triajesEnCurso.set(tenant.id, corrida);
  return corrida;
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

/**
 * Pregunta al buzón qué pasó con los borradores que dejamos esperando y cierra
 * los que el titular ya resolvió por su cuenta.
 *
 * Sin esto el panel miente: el titular envía un borrador desde Outlook y aquí
 * sigue contando como pendiente, porque él nunca toca el dashboard para
 * resolverlo — actúa en su cliente de correo, que es justo la gracia.
 */
async function reconciliarPendientes(tenant: Tenant, proveedor: EmailProvider): Promise<number> {
  const { data, error } = await supabase
    .from("asistente_correos")
    .select("id, borrador_id, gmail_thread_id")
    .eq("tenant_id", tenant.id)
    .is("resuelto_en", null)
    .not("borrador_id", "is", null)
    // Acotado: es una llamada de red por borrador, y los viejos ya se
    // revisaron en corridas anteriores.
    .order("procesado_en", { ascending: false })
    .limit(40);
  if (error || !data?.length) return 0;

  let cerrados = 0;
  for (const fila of data) {
    const estado = await proveedor.estadoRespuesta({
      borradorId: fila.borrador_id as string,
      hiloId: (fila.gmail_thread_id as string) ?? "",
    });
    // "pendiente" sigue esperando; "desconocido" es un fallo de consulta y no
    // debe cerrar nada — mejor mostrarlo de más que ocultarlo por error.
    if (estado === "pendiente" || estado === "desconocido") continue;

    await supabase
      .from("asistente_correos")
      .update({ resuelto_en: new Date().toISOString(), resolucion: estado })
      .eq("id", fila.id);
    cerrados += 1;
  }

  if (cerrados > 0) {
    console.log(`[asistente:${tenant.config.slug}] ${cerrados} borrador(es) que ya resolviste salieron de pendientes.`);
  }
  return cerrados;
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
  if (!data?.recibido_en) return null;
  // Volvemos a mirar una ventana solapada. Los proveedores listan primero lo
  // más nuevo; sin solape, un fallo a mitad de lote podía hacer que mensajes
  // más antiguos quedaran detrás de la marca y no se vieran nunca.
  return new Date(new Date(data.recibido_en).getTime() - 24 * 60 * 60 * 1000);
}

async function finalizarCorreo(tenantId: string, mensajeId: string, cambios: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("asistente_correos")
    .update(cambios)
    .eq("tenant_id", tenantId)
    .eq("gmail_message_id", mensajeId);
  if (error) throw error;
}

function alertaWhatsApp(
  tenant: Tenant,
  correo: CorreoEntrante,
  clasificacion: Clasificacion | null,
  hayBorrador = false,
  /** Presente si lo que frenó el envío fue el TEXTO, no el asunto del correo. */
  motivoTexto: string | null = null,
): string {
  const remitente = extraerDireccion(correo.encabezados.from);
  if (!clasificacion) {
    return [
      `⚠️ *${tenant.config.nombreBot}* — correo sin clasificar`,
      "",
      `*De:* ${remitente}`,
      `*Asunto:* ${correo.encabezados.subject}`,
      "",
      "No pude analizarlo con seguridad, así que no envié nada. Revísalo tú en tu bandeja.",
    ].join("\n");
  }

  // El motivo del escalamiento cambia el mensaje: no es lo mismo "esto te toca
  // a ti" que "no te entendí" o "la redacté mal". El titular decide distinto
  // en cada caso.
  const motivo = motivoTexto
    ? `Redacté la respuesta pero no la envié: ${motivoTexto}`
    : clasificacion.requiereDecisionPersonal
      ? "Esto debería salir de tu parte, así que no lo envié."
      : `No estoy seguro de haber entendido bien (confianza ${Math.round(clasificacion.confianza * 100)}%), así que no lo envié.`;

  const cierre = hayBorrador
    ? "Te dejé la respuesta escrita como borrador: revísala, ajústala si hace falta y dale a Enviar."
    : "El correo quedó intacto en tu bandeja.";

  return [
    `🔍 *${tenant.config.nombreBot}* — necesito tu criterio`,
    "",
    `*De:* ${remitente}`,
    `*Asunto:* ${correo.encabezados.subject}`,
    `*Categoría:* ${clasificacion.categoria} · *Prioridad:* ${clasificacion.prioridad}`,
    "",
    `_${clasificacion.justificacion}_`,
    "",
    `${motivo} ${cierre}`,
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
      .select("resultado, resuelto_en")
      .eq("tenant_id", tenant.id)
      .gte("procesado_en", desde.toISOString());
    if (error) throw error;

    const filas = data ?? [];
    const enviados = filas.filter((f: any) => f.resultado === "enviado").length;
    const borradores = filas.filter((f: any) => f.resultado === "auto").length;
    // Lo que el titular ya resolvió en su buzón deja de contar como pendiente.
    const pendientes = filas.filter(
      (f: any) => (f.resultado === "revision" || f.resultado === "error") && !f.resuelto_en,
    ).length;

    return [
      `📊 *${tenant.config.nombreBot}* — resumen de hoy`,
      `Correos revisados: ${filas.length}`,
      `Respondidos y enviados: ${enviados}`,
      ...(borradores ? [`Borradores listos: ${borradores}`] : []),
      `Esperando tu revisión: ${pendientes}`,
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
async function ejecutarTriajeInterno(tenant: Tenant): Promise<ResumenCorrida> {
  const asistente = tenant.config.asistente;
  const resumen: ResumenCorrida = {
    revisados: 0,
    descartadosHeuristica: 0,
    clasificados: 0,
    enviados: 0,
    reconciliados: 0,
    borradoresCreados: 0,
    escaladosRevision: 0,
    error: null,
  };

  if (!asistente) {
    resumen.error = "Este bot no tiene el asistente configurado.";
    return resumen;
  }

  // Antes de registrar una ejecución comprobamos que existan credenciales.
  // Así un asistente aún no conectado no llena la bitácora cada pocos minutos.
  let proveedor: EmailProvider | null = null;
  try {
    proveedor = await obtenerProveedorCorreo(tenant);
  } catch (error: any) {
    resumen.error = error?.message ?? "No se pudo abrir la conexión de correo.";
    return resumen;
  }
  if (!proveedor) {
    resumen.error = "El correo no está conectado. Autoriza la cuenta desde el dashboard.";
    return resumen;
  }

  const { data: ejecucion } = await supabase
    .from("asistente_ejecuciones")
    .insert({ tenant_id: tenant.id })
    .select("id")
    .maybeSingle();
  const ejecucionId = ejecucion?.id as string | undefined;

  try {
    // Primero se pone al día con lo que el titular ya resolvió; así el panel
    // refleja la realidad aunque no haya llegado ningún correo nuevo.
    resumen.reconciliados = await reconciliarPendientes(tenant, proveedor);

    // Se lee en cada corrida (no de la config del bot) para que el interruptor
    // del Owner Console surta efecto sin redesplegar.
    const enviarAutomatico = await envioAutomaticoActivo(tenant);

    const desde = await obtenerUltimaMarca(tenant.id);
    // Pedimos una ventana mayor que el lote de trabajo y procesamos primero
    // los pendientes más antiguos. Así una ráfaga de correos nuevos no deja
    // los anteriores hambrientos para siempre.
    const ventana = Math.min(Math.max(asistente.maxPorCorrida * 10, 100), 500);
    const candidatos = await proveedor.listarNuevos(desde, ventana);
    const noProcesados = await filtrarYaProcesados(tenant.id, candidatos);
    const pendientes = noProcesados.slice(-asistente.maxPorCorrida).reverse();

    for (const id of pendientes) {
      const correo = await proveedor.obtener(id);
      if (!correo) continue;
      resumen.revisados += 1;

      const fila: Record<string, unknown> = {
        tenant_id: tenant.id,
        gmail_message_id: correo.id,
        gmail_thread_id: correo.hiloId,
        remitente: extraerDireccion(correo.encabezados.from),
        asunto: correo.encabezados.subject.slice(0, 500),
        recibido_en: correo.recibidoEn,
      };

      // Reserva el mensaje ANTES de cualquier efecto externo. Si el proceso
      // cae justo después de enviar, la fila queda en "error" para revisión,
      // pero jamás se vuelve a enviar una respuesta duplicada al reiniciar.
      const { error: reservaError } = await supabase
        .from("asistente_correos")
        .insert({ ...fila, resultado: "error" });
      if (reservaError?.code === "23505") continue;
      if (reservaError) throw reservaError;

      // ---- Capa 1: filtro determinista (sin coste) -------------------------
      const heuristica = evaluarHeuristica(correo.encabezados);
      if (!heuristica.procesar) {
        resumen.descartadosHeuristica += 1;
        await finalizarCorreo(tenant.id, correo.id, {
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
        await finalizarCorreo(tenant.id, correo.id, { resultado: "error", alerta_enviada: avisado });
        await proveedor.etiquetar(correo.id, "revision");
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

      // Avisos, recibos y mensajes informativos no merecen una respuesta. Esto
      // evita ruido, auto-respuestas en bucle y correos incómodos al cliente.
      if (!clasificacion.requiereAccion) {
        await finalizarCorreo(tenant.id, correo.id, { ...fila, resultado: "omitido" });
        continue;
      }

      // ---- Capa 3: ¿enviar solo, o dejar borrador? -------------------------
      // Lo rutinario se responde Y SE ENVÍA, que es lo que de verdad vacía la
      // bandeja. El titular solo toca dos tipos de correo:
      //   1. Los que debe contestar él en persona (legal, dinero, seguridad,
      //      decisiones de negocio, conflictos delicados).
      //   2. Los que la IA no entendió — enviar ahí sería mandar un disparate
      //      a nombre del titular, sin vuelta atrás.
      // En ambos casos NO se envía nada: se deja el borrador listo y se avisa,
      // para que revisar sea un clic y no volver a escribir.
      const noEntendio = clasificacion.confianza < asistente.umbralConfianza;
      const respuesta = clasificacion.borrador;
      const destino = respuesta ? construirDestinoSeguro(correo, respuesta.cuerpo) : null;

      // Última barrera antes de mandar algo a nombre del titular: el prompt
      // prohíbe plantillas a medio llenar, pero un prompt no es una garantía.
      // Si el texto trae huecos, se trata como un correo que debe revisar él.
      const revisionTexto = respuesta ? validarParaEnvio(respuesta.cuerpo) : null;
      const textoInseguro = revisionTexto !== null && !revisionTexto.seguro;
      if (textoInseguro) {
        console.warn(
          `[asistente:${tenant.config.slug}] Respuesta retenida para ${correo.id}: ${revisionTexto!.motivo}`,
        );
      }

      const debeDecidirElTitular =
        clasificacion.requiereDecisionPersonal || noEntendio || textoInseguro || Boolean(respuesta && !destino);

      if (!debeDecidirElTitular && destino && enviarAutomatico) {
        try {
          await proveedor.enviar(destino);
          resumen.enviados += 1;
          await finalizarCorreo(tenant.id, correo.id, { ...fila, resultado: "enviado" });
          await proveedor.etiquetar(correo.id, "enviado");
        } catch (err) {
          // Si el envío falla no perdemos el trabajo: se deja como borrador y
          // se avisa, que es el mismo camino de los correos que sí revisa.
          console.error(`[asistente:${tenant.config.slug}] Falló el envío de ${correo.id}; queda en borrador:`, err);
          const borradorId = await proveedor.crearBorrador(destino).catch(() => null);
          resumen.escaladosRevision += 1;
          const avisado = await avisarEjecutivo(
            tenant,
            `⚠️ *${tenant.config.nombreBot}* — no pude enviar una respuesta\n\n*Para:* ${destino.para}\n*Asunto:* ${correo.encabezados.subject}\n\nLa dejé como borrador en tu bandeja para que la envíes tú.`,
          );
          await finalizarCorreo(tenant.id, correo.id, {
            ...fila,
            resultado: "revision",
            borrador_id: borradorId,
            alerta_enviada: avisado,
          });
          await proveedor.etiquetar(correo.id, "revision");
        }
        continue;
      }

      if (!debeDecidirElTitular && destino) {
        // Envío automático apagado para este cliente: se comporta como antes,
        // dejando todo en borradores.
        const borradorId = await proveedor.crearBorrador(destino).catch((err) => {
          console.error(`[asistente:${tenant.config.slug}] No se pudo crear el borrador de ${correo.id}:`, err);
          return null;
        });
        resumen.borradoresCreados += 1;
        await finalizarCorreo(tenant.id, correo.id, { ...fila, resultado: "auto", borrador_id: borradorId });
        await proveedor.etiquetar(correo.id, "borrador");
        continue;
      }

      if (!debeDecidirElTitular) {
        // Clasificado sin problema, pero la IA no produjo texto que ofrecer.
        // No es motivo para molestar al titular: queda registrado y ya.
        await finalizarCorreo(tenant.id, correo.id, { ...fila, resultado: "auto" });
        continue;
      }

      // Requiere su criterio → NO se envía. Se le deja el borrador escrito y
      // se le avisa, para que solo tenga que revisarlo y darle a Enviar.
      const borradorId = destino
        ? await proveedor.crearBorrador(destino).catch((err) => {
            console.error(`[asistente:${tenant.config.slug}] No se pudo dejar el borrador de ${correo.id}:`, err);
            return null;
          })
        : null;
      if (borradorId) resumen.borradoresCreados += 1;
      resumen.escaladosRevision += 1;
      const avisado = await avisarEjecutivo(
        tenant,
        alertaWhatsApp(tenant, correo, clasificacion, Boolean(borradorId), revisionTexto?.motivo ?? null),
      );
      await finalizarCorreo(tenant.id, correo.id, {
        ...fila,
        resultado: "revision",
        borrador_id: borradorId,
        alerta_enviada: avisado,
      });
      await proveedor.etiquetar(correo.id, "revision");
    }
  } catch (err: any) {
    resumen.error = err?.message ?? "Error inesperado durante el triaje.";
    console.error(`[asistente:${tenant.config.slug}] Triaje fallido:`, err);
  } finally {
    // IMAP mantiene un socket abierto; dejarlo colgado agota las conexiones
    // del servidor de correo tras unas cuantas corridas.
    await proveedor?.cerrar?.().catch(() => {});
  }

  if (ejecucionId) {
    await supabase
      .from("asistente_ejecuciones")
      .update({
        finalizado_en: new Date().toISOString(),
        revisados: resumen.revisados,
        descartados_heuristica: resumen.descartadosHeuristica,
        clasificados: resumen.clasificados,
        enviados: resumen.enviados,
        borradores_creados: resumen.borradoresCreados,
        escalados_revision: resumen.escaladosRevision,
        error: resumen.error,
      })
      .eq("id", ejecucionId);
  }

  return resumen;
}
