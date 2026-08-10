import { extraerDireccion } from "./heuristica.js";
import type { CorreoEntrante, RespuestaCorreo } from "./proveedores/index.js";

/**
 * Construye el sobre de respuesta exclusivamente desde el mensaje original.
 * El modelo solo controla el cuerpo: nunca el destinatario ni cabeceras MIME.
 */
export function construirDestinoSeguro(correo: CorreoEntrante, cuerpo: string): RespuestaCorreo | null {
  const para = extraerDireccion(correo.encabezados.from).trim().toLowerCase();
  if (!/^[^@\s\r\n]+@[^@\s\r\n]+\.[^@\s\r\n]+$/.test(para)) return null;

  const messageId = correo.messageId?.trim();
  return {
    hiloId: correo.hiloId,
    para,
    asunto: correo.encabezados.subject.replace(/[\r\n]+/g, " ").slice(0, 500),
    cuerpo,
    ...(messageId && /^<[^<>\r\n]+>$/.test(messageId) ? { messageId } : {}),
  };
}

export function booleanoEstricto(valor: unknown): boolean {
  return valor === true || (typeof valor === "string" && valor.trim().toLowerCase() === "true");
}

/** Señales conservadoras de instrucciones dirigidas al sistema y no al humano. */
export function contieneInyeccionDePrompt(texto: string): boolean {
  return /(ignora|omite|olvida|ignore|disregard|forget).{0,40}(instrucciones|instructions|prompt)|\b(system prompt|prompt del sistema)\b|\b(revela|muestra|imprime|reveal|show|print).{0,40}(instrucciones|instructions|prompt)\b/i.test(
    texto,
  );
}
