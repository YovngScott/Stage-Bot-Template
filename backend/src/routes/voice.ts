import { Router, type Request, type Response } from "express";
import { obtenerOCrearCliente } from "../services/clientes.js";
import { ejecutarTool } from "../tools/executor.js";

export const voiceRouter = Router({ mergeParams: true });

/**
 * Webhook universal para Bots de Llamadas de Voz (Vapi.ai, Retell AI, Bland AI o llamadas custom).
 * Expone las MISMAS herramientas de agendamiento y catálogo creadas para WhatsApp.
 *
 * Admite:
 * 1. Formato Vapi.ai (POST /api/:slug/voice/webhook)
 * 2. Formato Genérico (POST /api/:slug/voice/tool-call)
 * 3. Verificación de estado (GET /api/:slug/voice/webhook)
 */

voiceRouter.get("/webhook", (req: Request, res: Response) => {
  return res.json({
    ok: true,
    servicio: "voice-webhook",
    tenant: req.tenant?.config.slug,
    mensaje: "El endpoint de llamadas está activo. Los bots de voz (Vapi/Retell) deben enviar peticiones HTTP POST.",
  });
});

voiceRouter.post("/webhook", async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const body = req.body ?? {};

  // Formato Vapi.ai (message.type === "tool-calls" o toolCall directo)
  if (body.message?.type === "tool-calls" || body.toolCall || body.message?.toolCalls) {
    const toolCalls = body.message?.toolWithToolCallList ?? body.message?.toolCalls ?? (body.toolCall ? [body.toolCall] : []);
    const customer = body.message?.call?.customer ?? body.call?.customer ?? {};
    const rawPhone = customer.number || body.phone || "+10000000000";
    const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
    const name = customer.name || "Cliente por Llamada";

    const cliente = await obtenerOCrearCliente(tenant.id, phone, name);
    const results = [];

    for (const call of toolCalls) {
      const toolCallId = call.toolCallId || call.id;
      const toolName = call.name || call.function?.name || body.name || body.toolName;
      const rawArgs = call.arguments || call.function?.arguments || body.arguments || body.args || {};
      const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;

      try {
        const { resultado } = await ejecutarTool(toolName, args, tenant, cliente);
        results.push({ toolCallId, result: resultado });
      } catch (err) {
        results.push({
          toolCallId,
          result: `Error en ${toolName}: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (results.length > 0) {
      return res.json({ results, result: results[0]?.result });
    }
  }

  // Formato Genérico / Retell / Bland / Vapi Direct Request
  const toolName = body.name || body.toolName || body.function?.name || body.toolCall?.name;
  const rawPhone = body.phone || body.customerNumber || body.call?.customer?.number || "+10000000000";
  const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
  const name = body.customerName || body.nameClient || body.call?.customer?.name || "Cliente por Llamada";
  const rawArgs = body.arguments || body.args || body.function?.arguments || body.toolCall?.function?.arguments || {};
  const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;

  if (!toolName) {
    return res.status(400).json({ error: "Falta el nombre de la herramienta (toolName)." });
  }

  try {
    const cliente = await obtenerOCrearCliente(tenant.id, phone, name);
    const { resultado, esError } = await ejecutarTool(toolName, args, tenant, cliente);
    return res.json({ ok: !esError, toolName, result: resultado, results: [{ result: resultado }] });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      toolName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** Endpoint para invocar una herramienta específica directamente por URL */
voiceRouter.get("/tools/:toolName", (req: Request, res: Response) => {
  return res.json({
    ok: true,
    servicio: "voice-tools",
    tool: req.params.toolName,
    tenant: req.tenant?.config.slug,
    mensaje: `Endpoint de ${req.params.toolName} activo. Enviar petición POST para ejecutar.`,
  });
});

voiceRouter.post("/tools/:toolName", async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const toolName = req.params.toolName;
  const body = req.body ?? {};
  const rawPhone = body.phone || body.telefono || "+10000000000";
  const phone = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone}`;
  const name = body.nombre || body.name || "Cliente por Llamada";
  const rawArgs = body.arguments || body.args || body;
  const args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;

  try {
    const cliente = await obtenerOCrearCliente(tenant.id, phone, name);
    const { resultado, esError } = await ejecutarTool(toolName, args, tenant, cliente);
    return res.json({ ok: !esError, toolName, result: resultado, results: [{ result: resultado }] });
  } catch (err) {
    return res.status(400).json({
      ok: false,
      toolName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
