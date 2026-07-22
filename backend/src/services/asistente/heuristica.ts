/**
 * Capa determinista que corre ANTES de gastar una llamada de IA. Su único
 * objetivo es descartar remitentes automatizados (no-reply, boletines, avisos
 * masivos): son la mayor parte del volumen de una bandeja corporativa y no
 * requieren ningún análisis cognitivo.
 *
 * Es puro análisis de encabezados — sin red, sin tokens, sin coste.
 */

/** Direcciones que jamás esperan respuesta humana. */
const REMITENTES_AUTOMATICOS = /^(no-?reply|bounce|notifications?|newsletters?|mailer-daemon|postmaster|do-?not-?reply)@/i;

/** Encabezados que delatan correo masivo o generado por una máquina. */
const PRECEDENCE_MASIVA = new Set(["bulk", "junk", "list"]);
const AUTO_SUBMITTED_AUTOMATICO = /auto-(generated|replied|notified)/i;

export interface EncabezadosCorreo {
  from: string;
  subject: string;
  listUnsubscribe?: string;
  precedence?: string;
  autoSubmitted?: string;
}

export type MotivoDescarte = "remitente_automatico" | "lista_de_correo" | "precedencia_masiva" | "auto_generado";

export interface ResultadoHeuristica {
  /** true = el correo merece análisis de IA. */
  procesar: boolean;
  motivo: MotivoDescarte | null;
}

/** Extrae la dirección de un encabezado From tipo `Nombre <a@b.com>`. */
export function extraerDireccion(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim().toLowerCase();
}

/**
 * Decide si un correo pasa a la capa de IA. Devuelve además el motivo del
 * descarte para poder mostrarlo en el dashboard y auditar el filtro.
 */
export function evaluarHeuristica(encabezados: EncabezadosCorreo): ResultadoHeuristica {
  const direccion = extraerDireccion(encabezados.from ?? "");

  if (REMITENTES_AUTOMATICOS.test(direccion)) {
    return { procesar: false, motivo: "remitente_automatico" };
  }
  // Un List-Unsubscribe es la señal más fiable de boletín/marketing masivo.
  if (encabezados.listUnsubscribe) {
    return { procesar: false, motivo: "lista_de_correo" };
  }
  if (encabezados.precedence && PRECEDENCE_MASIVA.has(encabezados.precedence.trim().toLowerCase())) {
    return { procesar: false, motivo: "precedencia_masiva" };
  }
  if (encabezados.autoSubmitted && AUTO_SUBMITTED_AUTOMATICO.test(encabezados.autoSubmitted)) {
    return { procesar: false, motivo: "auto_generado" };
  }

  return { procesar: true, motivo: null };
}

/** Texto legible del motivo, para el dashboard y el reporte de fin de día. */
export function describirMotivo(motivo: MotivoDescarte): string {
  switch (motivo) {
    case "remitente_automatico":
      return "Remitente automático (no-reply)";
    case "lista_de_correo":
      return "Boletín o lista de correo";
    case "precedencia_masiva":
      return "Correo masivo (Precedence)";
    case "auto_generado":
      return "Respuesta generada automáticamente";
  }
}
