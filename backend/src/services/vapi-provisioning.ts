import { config } from "../lib/config.js";
import type { Tenant } from "../lib/tenants.js";

/**
 * Aprovisionamiento 100% Automático de Asistentes de Voz en Vapi.ai.
 *
 * Cuando el Bot Builder crea un bot nuevo (o al arrancar un tenant con módulo de voz),
 * esta función genera automáticamente el Asistente en Vapi.ai con:
 * - El System Prompt poblado con los datos reales de la empresa (nombre, horario, dirección, etc.).
 * - Sus 5 herramientas vinculadas a la URL del webhook en la nube (`/api/:slug/voice/webhook`).
 * - Transcriptor en español (Deepgram) y Voz sintética.
 */
export async function aprovisionarAsistenteVapi(
  tenant: Tenant,
): Promise<{ assistantId?: string; error?: string }> {
  const apiKey = process.env.VAPI_API_KEY || config.vapi?.apiKey;

  if (!apiKey) {
    console.log(
      `[vapi] VAPI_API_KEY no configurada. El webhook de voz para "${tenant.config.slug}" está activo y listo en /api/${tenant.config.slug}/voice/webhook.`,
    );
    return {};
  }

  const baseUrl = process.env.PUBLIC_URL || "https://wiltech-bot.fly.dev";
  const webhookUrl = `${baseUrl}/api/${tenant.config.slug}/voice/webhook`;

  const systemPrompt = `Eres la asistente telefónica oficial de ${tenant.config.nombre}. Hablas en español de forma breve, amable y profesional.

## INFORMACIÓN OFICIAL DE LA EMPRESA:
- Nombre: ${tenant.config.nombre}
- Descripción: ${tenant.config.descripcion}
- Ubicación: ${tenant.config.direccion}
- Horario de Atención: ${tenant.config.horario}
- Contacto: ${tenant.config.contacto}
- Servicios: ${tenant.config.servicios}
- Moneda: ${tenant.config.moneda}

## HERRAMIENTAS Y FUNCIONES:
1. Precios y repuestos: Usa la herramienta consultar_catalogo. Presenta precios en ${tenant.config.moneda}. Nunca reveles números exactos de existencias al cliente.
2. Disponibilidad en calendario: Usa la herramienta verificar_disponibilidad.
3. Agendar cita: Usa agendar_cita cuando el cliente confirme.
4. Reprogramar cita: Usa reprogramar_cita.
5. Cancelar cita: Usa cancelar_cita.

## REGLAS DE VOZ:
- Responde de forma muy concisa (máximo 2 a 3 oraciones por turno) para que la llamada telefónica sea muy fluida.
- Habla exclusivamente en español.
${tenant.config.promptExtra ?? ""}`;

  const payload = {
    name: `${tenant.config.nombre} (Voice Assistant)`,
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: systemPrompt }],
      tools: [
        {
          type: "api_request",
          async: false,
          server: { url: webhookUrl, method: "POST" },
          function: {
            name: "consultar_catalogo",
            description: "Consulta precios y disponibilidad en el catálogo",
          },
        },
        {
          type: "api_request",
          async: false,
          server: { url: webhookUrl, method: "POST" },
          function: {
            name: "verificar_disponibilidad",
            description: "Verifica horarios libres en Google Calendar",
          },
        },
        {
          type: "api_request",
          async: false,
          server: { url: webhookUrl, method: "POST" },
          function: {
            name: "agendar_cita",
            description: "Agenda una cita de servicio en Google Calendar",
          },
        },
        {
          type: "api_request",
          async: false,
          server: { url: webhookUrl, method: "POST" },
          function: {
            name: "reprogramar_cita",
            description: "Cambia la fecha de una cita existente",
          },
        },
        {
          type: "api_request",
          async: false,
          server: { url: webhookUrl, method: "POST" },
          function: {
            name: "cancelar_cita",
            description: "Cancela una cita agendada",
          },
        },
      ],
    },
    transcriber: { provider: "deepgram", model: "nova-2", language: "es" },
    voice: { provider: "11labs", voiceId: "paola", language: "es" },
    firstMessage: `¡Hola! Gracias por comunicarse con ${tenant.config.nombre}. ¿En qué le puedo ayudar hoy?`,
  };

  try {
    const res = await fetch("https://api.vapi.ai/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(
        `[vapi] Error aprovisionando asistente en Vapi.ai para "${tenant.config.slug}":`,
        errText,
      );
      return { error: errText };
    }

    const data = (await res.json()) as { id: string };
    console.log(
      `[vapi] Asistente de Voz creado automáticamente en Vapi.ai para "${tenant.config.slug}": Assistant ID ${data.id}`,
    );
    return { assistantId: data.id };
  } catch (err) {
    console.error(
      `[vapi] Excepción conectando a Vapi.ai API para "${tenant.config.slug}":`,
      err,
    );
    return { error: String(err) };
  }
}
