import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { config } from "../lib/config.js";
import type { Cliente, Mensaje } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";
import { tools } from "../tools/definitions.js";
import { ejecutarTool } from "../tools/executor.js";
import { systemPrompt } from "./prompt.js";

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

const MAX_ITERACIONES = 8;

async function generarConReintento(
  params: Parameters<typeof ai.models.generateContent>[0],
  intentos = 3,
): Promise<Awaited<ReturnType<typeof ai.models.generateContent>>> {
  let ultimoError: any;
  for (let i = 0; i < intentos; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err: any) {
      const status = err?.status ?? err?.code;
      const temporal = status === 500 || status === 503;
      if (!temporal || i === intentos - 1) throw err;
      ultimoError = err;
      const espera = 800 * (i + 1);
      console.warn(`[gemini] ${status} temporal, reintentando en ${espera}ms…`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimoError;
}

function historialAContents(historial: Mensaje[]): Content[] {
  const contents: Content[] = [];
  for (const m of historial) {
    if (m.rol === "sistema") continue;
    const role = m.rol === "cliente" ? "user" : "model";
    contents.push({ role, parts: [{ text: m.contenido }] });
  }
  while (contents.length && contents[0].role !== "user") contents.shift();
  return contents;
}

export interface RespuestaAgente {
  texto: string;
  tokensEntrada: number;
  tokensSalida: number;
}

export async function generarRespuesta(
  tenant: Tenant,
  cliente: Cliente,
  historial: Mensaje[],
  mensajeNuevo: string,
): Promise<RespuestaAgente> {
  const contents: Content[] = [
    ...historialAContents(historial),
    { role: "user", parts: [{ text: mensajeNuevo }] },
  ];

  let tokensEntrada = 0;
  let tokensSalida = 0;

  try {
    for (let i = 0; i < MAX_ITERACIONES; i++) {
      const response = await generarConReintento({
        model: config.gemini.model,
        contents,
        config: {
          systemInstruction: systemPrompt(tenant, cliente),
          temperature: 0.2,
          maxOutputTokens: 1024,
          tools: [{ functionDeclarations: tools }],
        },
      });

      tokensEntrada += response.usageMetadata?.promptTokenCount ?? 0;
      tokensSalida += response.usageMetadata?.candidatesTokenCount ?? 0;

      const llamadas = response.functionCalls ?? [];

      if (llamadas.length === 0) {
        const texto = (response.text ?? "").trim();
        return { texto: texto || "…", tokensEntrada, tokensSalida };
      }

      const turnoModelo = response.candidates?.[0]?.content;
      if (turnoModelo) contents.push(turnoModelo);

      const partesResultado: Part[] = [];
      for (const llamada of llamadas) {
        const { resultado, esError } = await ejecutarTool(
          llamada.name ?? "",
          (llamada.args ?? {}) as Record<string, any>,
          tenant,
          cliente,
        );
        partesResultado.push({
          functionResponse: {
            name: llamada.name ?? "",
            response: esError ? { error: resultado } : { resultado },
          },
        });
      }
      contents.push({ role: "user", parts: partesResultado });
    }
  } catch (err) {
    console.error("[gemini] Error generando respuesta:", err);
    return {
      texto: `Disculpa, en este momento tengo un inconveniente técnico. Un asesor de ${tenant.config.nombre} te responderá en breve por este chat. 🙏`,
      tokensEntrada,
      tokensSalida,
    };
  }

  return {
    texto: `Disculpa, tuve un problema procesando tu solicitud. Un asesor de ${tenant.config.nombre} te contactará en breve. 🙏`,
    tokensEntrada,
    tokensSalida,
  };
}
