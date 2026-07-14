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
  if (config.ai.provider === "gemini") {
    return conGemini(tenant, cliente, historial, mensaje);
  }

  try {
    return await conGroq(tenant, cliente, historial, mensaje);
  } catch (err) {
    console.warn("[ia] Groq no estuvo disponible; intentando responder con Gemini:", err);
    if (config.gemini.apiKey) {
      return conGemini(tenant, cliente, historial, mensaje);
    }
    return {
      texto: `Disculpa, en este momento tengo un inconveniente técnico. Un asesor de ${tenant.config.nombre} te responderá en breve por este chat. 🙏`,
      tokensEntrada: 0,
      tokensSalida: 0,
    };
  }
}
