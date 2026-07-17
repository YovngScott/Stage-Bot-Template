import { config } from "../lib/config.js";
import type { Cliente, Mensaje } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";
import { generarRespuesta as conGroq } from "./groq.js";
import { generarRespuesta as conGemini } from "./gemini.js";

/**
 * Punto único para generar la respuesta del bot. Elige el proveedor de IA
 * según AI_PROVIDER: "groq" (por defecto) o "gemini", con Gemini como
 * respaldo automático si Groq alcanza su límite gratuito.
 */
export async function generarRespuesta(tenant: Tenant, cliente: Cliente, historial: Mensaje[], mensaje: string) {
  const respaldo = {
    texto: "Disculpa, se me complicó un poco procesar tu mensaje. Dame un momento y sigo contigo por aquí. 🙏",
    tokensEntrada: 0,
    tokensSalida: 0,
  };

  // Esta función NUNCA debe lanzar: pase lo que pase con los proveedores de
  // IA, tiene que devolver un texto para que el bot responda algo y no deje
  // al cliente viendo "escribiendo…" sin respuesta.
  if (config.ai.provider === "gemini") {
    try {
      return await conGemini(tenant, cliente, historial, mensaje);
    } catch (err) {
      console.error("[ia] Gemini falló y no hay otro proveedor:", err);
      return respaldo;
    }
  }

  try {
    return await conGroq(tenant, cliente, historial, mensaje);
  } catch (err) {
    console.warn("[ia] Groq no estuvo disponible; intentando responder con Gemini:", err);
    if (config.gemini.apiKey) {
      try {
        return await conGemini(tenant, cliente, historial, mensaje);
      } catch (err2) {
        console.error("[ia] Groq y Gemini fallaron ambos:", err2);
        return respaldo;
      }
    }
    return respaldo;
  }
}
