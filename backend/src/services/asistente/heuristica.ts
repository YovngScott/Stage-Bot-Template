/**
 * Capa determinista que corre ANTES de gastar una llamada de IA. Su único
 * objetivo es descartar remitentes automatizados (no-reply, boletines, avisos
 * masivos): son la mayor parte del volumen de una bandeja corporativa y no
 * requieren ningún análisis cognitivo.
 *
 * Es puro análisis de encabezados — sin red, sin tokens, sin coste.
 */

/**
 * Marcadores de buzón automático dentro de la parte local de la dirección.
 *
 * Van delimitados por separador (o extremo) en vez de anclados al inicio: en
 * la práctica casi ningún servicio usa `noreply@` a secas, sino
 * `azure-noreply@`, `account-security-noreply@`, `billing.notifications@`.
 * Anclarlo al inicio dejaba pasar justamente los más comunes.
 */
const MARCADORES_AUTOMATICOS =
  /(^|[.\-_+])(no-?reply|do-?not-?reply|donotreply|bounces?|mailer-daemon|postmaster|notifications?|newsletters?|automated|automailer)([.\-_+]|$)/i;

/** ¿La dirección corresponde a un buzón que jamás espera respuesta humana? */
function esRemitenteAutomatico(direccion: string): boolean {
  // Solo la parte local: un dominio como "notifications.empresa.com" puede
  // alojar buzones perfectamente humanos.
  const local = direccion.split("@")[0] ?? "";
  return MARCADORES_AUTOMATICOS.test(local);
}

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

  if (esRemitenteAutomatico(direccion)) {
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
