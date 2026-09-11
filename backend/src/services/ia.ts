import { config } from "../lib/config.js";
import type { Cliente, Mensaje } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";
import { generarRespuesta as conGroq } from "./groq.js";
import { generarRespuesta as conGemini } from "./gemini.js";
import { guardOutput, guardScope, guardSensitiveAction } from "./scope-guard.js";
import { runProviderFallback } from "./ai-fallback.js";

/**
 * Punto único de generación. El orden es Groq principal -> segunda clave Groq
 * -> Gemini. Si todos fallan LANZA: el canal debe retener la operación y
 * alertar; nunca inventar un texto técnico para enviarlo al cliente.
 */
export async function generarRespuesta(
  tenant: Tenant,
  cliente: Cliente,
  historial: Mensaje[],
  mensaje: string,
) {
  const scopeResponse = guardScope(tenant, mensaje);
  if (scopeResponse) return { texto: scopeResponse, tokensEntrada: 0, tokensSalida: 0 };
  const sensitiveResponse = guardSensitiveAction(tenant, mensaje);
  if (sensitiveResponse) return { texto: sensitiveResponse, tokensEntrada: 0, tokensSalida: 0 };

  type ProviderResult = {
    texto: string;
    tokensEntrada: number;
    tokensSalida: number;
    provider: "groq" | "gemini";
  };
  const secured = (result: ProviderResult) => ({
    ...result,
    texto: guardOutput(tenant, result.texto),
  });
  const providers: Array<() => Promise<ProviderResult>> = [];
  if (config.ai.provider !== "gemini") {
    providers.push(async () => ({
      ...(await conGroq(tenant, cliente, historial, mensaje)),
      provider: "groq",
    }));
    if (config.groq.fallbackApiKey && config.groq.fallbackApiKey !== config.groq.apiKey) {
      providers.push(async () => ({
        ...(await conGroq(tenant, cliente, historial, mensaje, { apiKey: config.groq.fallbackApiKey, model: config.groq.fallbackModel })),
        provider: "groq",
      }));
    }
  }
  if (config.gemini.apiKey) {
    providers.push(async () => ({
      ...(await conGemini(tenant, cliente, historial, mensaje)),
      provider: "gemini",
    }));
  }
  return secured(await runProviderFallback(providers));
}
