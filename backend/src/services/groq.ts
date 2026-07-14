import { config } from "../lib/config.js";
import type { Cliente, Mensaje } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";
import { tools } from "../tools/definitions.js";
import { ejecutarTool } from "../tools/executor.js";
import { systemPrompt } from "./prompt.js";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MAX_ITERACIONES = 8;

export interface RespuestaAgente {
  texto: string;
  tokensEntrada: number;
  tokensSalida: number;
}

/** Convierte un esquema de Gemini (type en MAYÚSCULAS) a JSON Schema (minúsculas). */
function aEsquemaJson(schema: any): any {
  if (Array.isArray(schema)) return schema.map(aEsquemaJson);
  if (schema && typeof schema === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(schema)) {
      out[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : aEsquemaJson(v);
    }
    return out;
  }
  return schema;
}

const toolsGroq = tools.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: aEsquemaJson(t.parameters) },
}));

interface MensajeGroq {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

function historialAMensajes(historial: Mensaje[]): MensajeGroq[] {
  const out: MensajeGroq[] = [];
  for (const m of historial) {
    if (m.rol === "sistema") continue;
    out.push({ role: m.rol === "cliente" ? "user" : "assistant", content: m.contenido });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function llamarGroq(mensajes: MensajeGroq[], intentos = 4): Promise<any> {
  for (let i = 0; i < intentos; i++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${config.groq.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.groq.model,
        messages: mensajes,
        tools: toolsGroq,
        tool_choice: "auto",
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });
    if (res.ok) return res.json();
    const cuerpo = await res.text();
    const ultimo = i === intentos - 1;

    if (res.status === 429 && !ultimo) {
      const m = cuerpo.match(/try again in ([\d.]+)s/i);
      const espera = m ? Math.ceil(parseFloat(m[1]) * 1000) + 500 : 0;
      if (espera <= 3500) {
        console.warn(`[groq] 429 (límite breve), esperando ${espera}ms y reintentando…`);
        await new Promise((r) => setTimeout(r, espera));
        continue;
      }
    }
    if ((res.status === 500 || res.status === 503) && !ultimo) {
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      continue;
    }
    throw new Error(`Groq ${res.status}: ${cuerpo.slice(0, 300)}`);
  }
  throw new Error("Groq: sin respuesta tras reintentos");
}

export async function generarRespuesta(
  tenant: Tenant,
  cliente: Cliente,
  historial: Mensaje[],
  mensajeNuevo: string,
): Promise<RespuestaAgente> {
  const mensajes: MensajeGroq[] = [
    { role: "system", content: systemPrompt(tenant, cliente) },
    ...historialAMensajes(historial),
    { role: "user", content: mensajeNuevo },
  ];

  let tokensEntrada = 0;
  let tokensSalida = 0;

  for (let i = 0; i < MAX_ITERACIONES; i++) {
    const data = await llamarGroq(mensajes);
    tokensEntrada += data.usage?.prompt_tokens ?? 0;
    tokensSalida += data.usage?.completion_tokens ?? 0;

    const msg = data.choices?.[0]?.message;
    const llamadas = msg?.tool_calls ?? [];

    if (llamadas.length === 0) {
      return { texto: (msg?.content ?? "").trim() || "…", tokensEntrada, tokensSalida };
    }

    mensajes.push({ role: "assistant", content: msg.content ?? null, tool_calls: llamadas });
    for (const tc of llamadas) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}");
      } catch {
        /* argumentos malformados → objeto vacío */
      }
      const { resultado } = await ejecutarTool(tc.function.name, args, tenant, cliente);
      mensajes.push({ role: "tool", tool_call_id: tc.id, content: resultado });
    }
  }

  throw new Error("Groq agotó el máximo de iteraciones de herramientas");
}
