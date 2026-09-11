import type { Tenant } from "../lib/tenants.js";
import { config } from "../lib/config.js";
import { conTimeout } from "../lib/timeout.js";
import { tenantBotActivo } from "../lib/tenants.js";
import { guardarMensaje, obtenerHistorialOptimizado, obtenerOCrearCliente } from "./clientes.js";
import { generarRespuesta } from "./ia.js";
import { sendInstagramText, type InstagramIncomingMessage } from "./meta-instagram.js";
import { queueFailure, recordMetric } from "./operations.js";
import {
  checkUsage,
  consentCommand,
  estimateAiCostUsd,
  getRuntimePolicy,
  isConversationHuman,
  isOptedOut,
  isSpamBurst,
  recordChannelEvent,
  recordUsage,
  setConsent,
  shouldAutoSend,
} from "./runtime-controls.js";

const queues = new Map<string, Promise<void>>();
const latestMessageByConversation = new Map<string, string>();

function enqueue(key: string, work: () => Promise<void>): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  queues.set(key, next);
  return next.finally(() => {
    if (queues.get(key) === next) queues.delete(key);
  });
}

export async function procesarMensajeInstagram(tenant: Tenant, incoming: InstagramIncomingMessage): Promise<void> {
  const configuredAccount = process.env.META_INSTAGRAM_ACCOUNT_ID?.trim();
  if (!configuredAccount || configuredAccount !== incoming.recipientId) {
    throw new Error("El evento no pertenece a la cuenta de Instagram configurada para este bot.");
  }
  const conversationKey = `${tenant.id}:instagram:${incoming.senderId}`;
  latestMessageByConversation.set(conversationKey, incoming.id);
  await enqueue(conversationKey, async () => {
    const contact = `ig:${incoming.senderId}`;
    const externalId = `instagram:${incoming.id}`;
    await recordChannelEvent({
      tenantId: tenant.id,
      channel: "instagram",
      externalId,
      eventType: "inbound",
      mediaType: incoming.mediaType,
      status: "received",
      metadata: { contact, instagramAccountId: incoming.recipientId },
    }).catch(() => undefined);

    const cliente = await obtenerOCrearCliente(tenant.id, contact);
    const saved = await guardarMensaje({
      tenant_id: tenant.id,
      cliente_id: cliente.id,
      rol: "cliente",
      contenido: incoming.text,
      // La columna mantiene su nombre histórico; el prefijo evita colisiones
      // y la restricción única hace la deduplicación durable del webhook.
      wa_message_id: externalId,
    });
    if (saved === null) return;

    const consent = consentCommand(incoming.text);
    if (consent) {
      await setConsent(tenant.id, "instagram", contact, consent, `Instagram ${incoming.id}`);
      if (consent === "opted_out") return;
    }
    if (await isOptedOut(tenant.id, "instagram", contact)) return;
    if (await isConversationHuman(tenant.id, "instagram", cliente.id)) return;
    if (!(await tenantBotActivo(tenant.id))) return;

    const usage = await checkUsage(tenant.id, "instagram");
    if (!usage.allowed || await isSpamBurst(tenant.id, "instagram", contact, usage.policy.spamPerMinute)) {
      await queueFailure({
        tenantSlug: tenant.config.slug,
        source: "instagram",
        operation: "limite_o_abuso_instagram",
        error: new Error(usage.reason || "Ráfaga de mensajes anormal"),
        dedupeKey: `${tenant.config.slug}:instagram-policy:${contact}:${new Date().toISOString().slice(0, 13)}`,
        maxAttempts: 1,
      }).catch(() => undefined);
      return;
    }

    // Agrupa mensajes consecutivos de la misma persona sin bloquear otras conversaciones.
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (latestMessageByConversation.get(conversationKey) !== incoming.id) return;

    const historialCompleto = await obtenerHistorialOptimizado(cliente.id, {
      desde: cliente.solicito_humano_en,
      hasta: cliente.atendido_en,
    }, 10);
    const historial = historialCompleto.at(-1)?.rol === "cliente" ? historialCompleto.slice(0, -1) : historialCompleto;
    if (cliente.estado === "requiere_humano") return;

    const startedAt = Date.now();
    let answer: Awaited<ReturnType<typeof generarRespuesta>> | null = null;
    try {
      answer = await conTimeout(generarRespuesta(tenant, cliente, historial, incoming.text), 45_000, "generarRespuestaInstagram");
    } catch (error) {
      await queueFailure({
        tenantSlug: tenant.config.slug,
        source: "instagram",
        operation: "generar_respuesta_instagram",
        error,
        dedupeKey: `${tenant.config.slug}:instagram-ai:${incoming.id}`,
      }).catch(() => undefined);
      return;
    }

    const text = answer?.texto.trim();
    if (!text) return;
    const policy = await getRuntimePolicy(tenant.id);
    if (!shouldAutoSend(policy, incoming.id)) return;
    if (!(await tenantBotActivo(tenant.id))) return;

    try {
      await sendInstagramText(incoming.senderId, text);
    } catch (error) {
      await queueFailure({
        tenantSlug: tenant.config.slug,
        source: "instagram",
        operation: "enviar_respuesta_instagram",
        error,
        dedupeKey: `${tenant.config.slug}:instagram-send:${incoming.id}`,
      }).catch(() => undefined);
      return;
    }

    await guardarMensaje({
      tenant_id: tenant.id,
      cliente_id: cliente.id,
      rol: "bot",
      contenido: text,
      tokens_entrada: answer?.tokensEntrada,
      tokens_salida: answer?.tokensSalida,
    });
    const costUsd = estimateAiCostUsd({
      inputTokens: answer?.tokensEntrada,
      outputTokens: answer?.tokensSalida,
      inputPerMillionUsd: config.aiPricing.groqInputPerMillionUsd,
      outputPerMillionUsd: config.aiPricing.groqOutputPerMillionUsd,
    });
    await recordMetric({ tenantSlug: tenant.config.slug, source: "instagram", latencyMs: Date.now() - startedAt, tokens: Number(answer?.tokensEntrada ?? 0) + Number(answer?.tokensSalida ?? 0) }).catch(() => undefined);
    await recordUsage(tenant.id, "instagram", { messages: 1, inputTokens: answer?.tokensEntrada, outputTokens: answer?.tokensSalida, costUsd }).catch(() => undefined);
  });
}
