import { GoogleGenerativeAI, type Content, type Part } from "@google/generative-ai";
import type { Tenant } from "../lib/tenants.js";
import type { Cliente, Mensaje } from "../lib/supabase.js";
import { systemPrompt } from "./prompt.js";
import { conTimeout } from "../lib/timeout.js";

export interface RespuestaAgente {
  texto: string;
  tokensEntrada: number;
  tokensSalida: number;
}

/**
 * Obtiene la API Key de Gemini exclusivamente desde variables de entorno.
 * Prioriza STAGE_GEMINI_API_KEY según el requerimiento de seguridad.
 */
function getApiKey(): string {
  const key = (
    process.env.STAGE_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();

  if (!key) {
    throw new Error(
      "[gemini] La variable de entorno STAGE_GEMINI_API_KEY no está configurada.",
    );
  }
  return key;
}

/**
 * Convierte el historial de mensajes al formato de Content para Gemini.
 */
function historialAContents(historial: Mensaje[]): Content[] {
  const contents: Content[] = [];
  for (const m of historial) {
    if (m.rol === "sistema") continue;
    const role = m.rol === "cliente" ? "user" : "model";
    contents.push({ role, parts: [{ text: m.contenido }] });
  }
  while (contents.length && contents[0].role !== "user") {
    contents.shift();
  }
  return contents;
}

/**
 * Motor Multimodal Nativo utilizando Gemini 1.5 Flash.
 * Admite procesamiento directo de audio (notas de voz) e imágenes con inlineData base64.
 */
export async function generarRespuestaGemini(
  historial: Mensaje[],
  mensajeNuevo: string,
  mediaBuffer?: Buffer,
  mimeType?: string,
  systemPromptText?: string,
): Promise<RespuestaAgente> {
  const apiKey = getApiKey();
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: systemPromptText
      ? { role: "system", parts: [{ text: systemPromptText }] }
      : undefined,
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
    },
  });

  const userParts: Part[] = [];

  // Si se recibe archivo multimedia (audio o imagen), se empaqueta con inlineData
  if (mediaBuffer && mimeType) {
    const base64Data = mediaBuffer.toString("base64");
    const cleanMime = mimeType.split(";")[0].trim().toLowerCase();
    userParts.push({
      inlineData: {
        mimeType: cleanMime,
        data: base64Data,
      },
    });
  }

  // Texto complementario o prompt de contexto
  if (mensajeNuevo && mensajeNuevo.trim()) {
    userParts.push({ text: mensajeNuevo.trim() });
  } else if (userParts.length > 0) {
    const isAudio = mimeType?.toLowerCase().includes("audio");
    userParts.push({
      text: isAudio
        ? "Escucha atentamente esta nota de voz recibida por WhatsApp del cliente y responde directamente a su solicitud o consulta con total naturalidad, calidez y precisión."
        : "Revisa atentamente esta imagen enviada por el cliente por WhatsApp y responde directamente a lo que consulta u observa.",
    });
  }

  const contents: Content[] = [
    ...historialAContents(historial),
    {
      role: "user",
      parts: userParts,
    },
  ];

  let ultimoError: any;
  const intentos = 3;

  for (let i = 0; i < intentos; i++) {
    try {
      const result = await conTimeout(
        model.generateContent({ contents }),
        25000,
        "Gemini 1.5 Flash generateContent",
      );

      const response = await result.response;
      const texto = response.text()?.trim() || "";
      const tokensEntrada = response.usageMetadata?.promptTokenCount ?? 0;
      const tokensSalida = response.usageMetadata?.candidatesTokenCount ?? 0;

      return {
        texto: texto || "…",
        tokensEntrada,
        tokensSalida,
      };
    } catch (err: any) {
      ultimoError = err;
      const status = err?.status ?? err?.code;
      const esTemporal =
        status === 500 ||
        status === 503 ||
        String(err?.message).includes("resource exhausted");
      if (!esTemporal || i === intentos - 1) {
        throw err;
      }
      const espera = 1000 * (i + 1);
      console.warn(
        `[gemini-1.5-flash] Error temporal (${status}), reintentando en ${espera}ms...`,
      );
      await new Promise((r) => setTimeout(r, espera));
    }
  }

  throw ultimoError;
}

/**
 * Adaptador de compatibilidad para el proveedor unificado en ia.ts
 */
export async function generarRespuesta(
  tenant: Tenant,
  cliente: Cliente,
  historial: Mensaje[],
  mensajeNuevo: string,
  mediaBuffer?: Buffer,
  mimeType?: string,
): Promise<RespuestaAgente> {
  const prompt = systemPrompt(tenant, cliente);
  return generarRespuestaGemini(
    historial,
    mensajeNuevo,
    mediaBuffer,
    mimeType,
    prompt,
  );
}
