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

/** Bloqueo determinista previo a la IA para temas generales y manipulación. */
export function guardScope(tenant: Tenant, message: string): string | null {
  const normalized = message.normalize("NFKC").trim();
  if (!normalized) return null;
  const blocked = [...INJECTION_PATTERNS, ...OFF_TOPIC_PATTERNS].some((pattern) => pattern.test(normalized));
  if (!blocked) return null;
  return `Solo puedo ayudarte con los productos, servicios y atención de ${tenant.config.nombre}. ¿Qué necesitas sobre eso?`;
}
