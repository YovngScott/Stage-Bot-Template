import { GoogleGenAI } from "@google/genai";
import { config } from "../lib/config.js";
import { conTimeout } from "../lib/timeout.js";

const ai = new GoogleGenAI({ apiKey: config.gemini.apiKey });

/**
 * Transcribe un archivo de audio (nota de voz de WhatsApp en .ogg/opus/mp3/wav)
 * a texto en español utilizando la capa gratuita de Gemini Flash.
 */
export async function transcribirAudio(
  buffer: Buffer,
  mimeType = "audio/ogg",
): Promise<string> {
  try {
    const base64Data = buffer.toString("base64");
    const response = await conTimeout(
      ai.models.generateContent({
        model: config.gemini.model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: "Transcribe exactamente el contenido del mensaje de voz recibido en español. Responde ÚNICAMENTE con el texto transcrito literal, sin explicaciones ni saludos.",
              },
            ],
          },
        ],
      }),
      30000,
      "transcribirAudio",
    );

    return response.text?.trim() ?? "";
  } catch (error) {
    console.error("[media] Error transcribiendo audio con Gemini:", error);
    return "";
  }
}

/**
 * Analiza el contenido visual de una imagen (captura, recibo, producto)
 * y devuelve una descripción detallada en español para el contexto de la IA.
 */
export async function analizarImagen(
  buffer: Buffer,
  mimeType = "image/jpeg",
  caption?: string,
): Promise<string> {
  try {
    const base64Data = buffer.toString("base64");
    const prompt = caption
      ? `El cliente envió una imagen acompañada del siguiente mensaje: "${caption}". Analiza la imagen minuciosamente y describe lo que se observa (productos, precios, textos, datos de comprobantes, etc.) para tener el contexto completo.`
      : "El cliente envió esta imagen sin texto. Analiza minuciosamente el contenido de la imagen y describe detalladamente lo que se observa (productos, recibos de pago, datos, capturas de pantalla, etc.) en español.";

    const response = await conTimeout(
      ai.models.generateContent({
        model: config.gemini.model,
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
      30000,
      "analizarImagen",
    );

    return response.text?.trim() ?? "";
  } catch (error) {
    console.error("[media] Error analizando imagen con Gemini:", error);
    return "";
  }
}
