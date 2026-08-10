import type { Tenant } from "../lib/tenants.js";

const OFF_TOPIC_PATTERNS = [
  /\b(alfabeto|abecedario|alphabet)\b/i,
  /\b(receta|recipe|poema|poetry|hor[oó]scopo)\b/i,
  /\b(traduce|traducir|translate)\b/i,
  /\b(presidente de|elecciones|partidos pol[ií]ticos|religiones?)\b/i,
  /\b(f[uú]tbol|football|b[eé]isbol|basketball|baloncesto)\b/i,
  /\b(resuelve|resolver|calcula|calculate)\b.{0,30}\b(ecuaci[oó]n|integral|derivada)\b/i,
];

const INJECTION_PATTERNS = [
  /ignora.{0,40}(instrucciones|reglas|prompt)/i,
  /(revela|muestra|repite).{0,40}(prompt|instrucciones internas|system message)/i,
  /act[uú]a como.{0,30}(sin reglas|desarrollador|modo dios)/i,
];

const SENSITIVE_PATTERNS = [
  /\b(contrasena|contraseña|password|api key|clave api|token)\b.{0,50}\b(dueno|dueño|empleado|empresa|sistema)\b/i,
  /\b(acepta|firma|confirma|aprueba)\b.{0,50}\b(contrato|reembolso|pago|indemnizacion|indemnización)\b/i,
];

/** Bloqueo determinista previo a la IA para temas generales y manipulación. */
export function guardScope(tenant: Tenant, message: string): string | null {
  const normalized = message.normalize("NFKC").trim();
  if (!normalized) return null;
  const blocked = [...INJECTION_PATTERNS, ...OFF_TOPIC_PATTERNS].some(
    (pattern) => pattern.test(normalized),
  );
  if (!blocked) return null;
  return `Solo puedo ayudarte con los productos, servicios y atención de ${tenant.config.nombre}. ¿Qué necesitas sobre eso?`;
}

/** Última barrera antes de enviar texto al cliente. */
export function guardOutput(tenant: Tenant, output: string): string {
  const leaked =
    /(system prompt|prompt interno|ámbito estricto|seguridad obligatoria|gsk_|sk-[a-z0-9]{8,}|api key is|contraseña es)/i.test(
      output,
    );
  if (!leaked) return output;
  return `No puedo compartir información interna. Puedo ayudarte con los productos, servicios y atención de ${tenant.config.nombre}.`;
}

export function guardSensitiveAction(
  tenant: Tenant,
  message: string,
): string | null {
  if (
    !SENSITIVE_PATTERNS.some((pattern) =>
      pattern.test(message.normalize("NFKC")),
    )
  )
    return null;
  return `Ese asunto requiere revisión de una persona de ${tenant.config.nombre}. Lo dejaré escalado para que te respondan con seguridad.`;
}
