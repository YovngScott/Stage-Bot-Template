import crypto from "node:crypto";

/**
 * `state` de un solo uso para el flujo de OAuth de Google, compartido por
 * TODOS los módulos que piden consentimiento (Calendar y el asistente).
 *
 * Vive aquí y no en una ruta porque Google siempre redirige al MISMO callback
 * fijo (/api/calendar/oauth-callback): quien genera el estado y quien lo
 * consume son archivos distintos, y deben mirar el mismo registro.
 */

const ESTADOS = new Map<string, { creado: number; slug: string }>();
const TTL_MS = 10 * 60 * 1000;

/** Crea un `state` opaco atado al slug del tenant. */
export function generarEstado(slug: string): string {
  const estado = crypto.randomBytes(16).toString("hex");
  ESTADOS.set(estado, { creado: Date.now(), slug });
  return estado;
}

/** Canjea un `state`: devuelve el slug y lo invalida. null si no existe o venció. */
export function consumirEstado(estado: string): string | null {
  const entrada = ESTADOS.get(estado);
  ESTADOS.delete(estado);
  if (!entrada || Date.now() - entrada.creado >= TTL_MS) return null;
  return entrada.slug;
}

// Un enlace que nadie abrió no debe quedarse en memoria para siempre.
setInterval(() => {
  const ahora = Date.now();
  for (const [estado, entrada] of ESTADOS) {
    if (ahora - entrada.creado >= TTL_MS) ESTADOS.delete(estado);
  }
}, TTL_MS).unref();
