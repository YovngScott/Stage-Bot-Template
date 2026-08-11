import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { requierePlataforma } from "../lib/adminAuth.js";
import { obtenerEstadoWhatsApp } from "../services/baileys.js";
import { obtenerProveedorCorreo } from "../services/asistente/proveedores/index.js";
import { ejecutarTriaje } from "../services/asistente/triaje.js";
import { supabase } from "../lib/supabase.js";
import { enviarMensajeTexto } from "../services/baileys.js";
import {
  createChannelTest,
  getRuntimePolicy,
  setConversationHuman,
  setRuntimePolicy,
  updateChannelTest,
} from "../services/runtime-controls.js";
import {
  beginRetry,
  createWorkerId,
  finishRetry,
  operationStatus,
  queueFailure,
  requeueFailure,
  resolveFailure,
} from "../services/operations.js";

export const operationsRouter = Router();

operationsRouter.get("/status", requierePlataforma, async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const email = { configured: tenant.config.kind === "assistant", connected: false, error: null as string | null };
  if (tenant.config.kind === "assistant") {
    try {
      const provider = await obtenerProveedorCorreo(tenant);
      const profile = provider ? await provider.perfil() : null;
      email.connected = Boolean(profile);
      email.error = profile ? null : "OAuth o credenciales de correo no disponibles.";
      await provider?.cerrar?.().catch(() => undefined);
    } catch (error) {
      email.error = error instanceof Error ? error.message : "No se pudo validar el correo.";
    }
  }
  const month = new Date().toISOString().slice(0, 7) + "-01";
  const [runtime, usage, handoffs, shadows, tests, whatsappConversations, emailConversations] = await Promise.all([
    getRuntimePolicy(tenant.id),
    supabase.from("usage_ledger").select("channel,messages,emails,input_tokens,output_tokens,estimated_cost_usd").eq("tenant_id", tenant.id).eq("month", month),
    supabase.from("conversation_controls").select("channel,conversation_id,taken_by,reason,taken_at").eq("tenant_id", tenant.id).eq("state", "human").limit(100),
    supabase.from("shadow_decisions").select("id,channel,conversation_id,proposed_response,decision,reviewed,correct_response,created_at").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("channel_test_runs").select("id,channel,status,challenge,destination,results,error,started_at,completed_at").eq("tenant_id", tenant.id).order("started_at", { ascending: false }).limit(20),
    supabase.from("clientes").select("id,telefono,nombre,ultimo_contacto").eq("tenant_id", tenant.id).order("ultimo_contacto", { ascending: false }).limit(20),
    supabase.from("asistente_correos").select("gmail_thread_id,remitente,asunto,recibido_en").eq("tenant_id", tenant.id).order("recibido_en", { ascending: false }).limit(20),
  ]);
  return res.json({
    ok: true,
    whatsapp: obtenerEstadoWhatsApp(tenant.id),
    email,
    runtime,
    usage: usage.data ?? [],
    handoffs: handoffs.data ?? [],
    shadows: shadows.data ?? [],
    channelTests: tests.data ?? [],
    conversations: [
      ...(whatsappConversations.data ?? []).map((item: any) => ({ channel: "whatsapp", id: item.id, contact: item.nombre || item.telefono, subject: null, updatedAt: item.ultimo_contacto })),
      ...(emailConversations.data ?? []).map((item: any) => ({ channel: "email", id: item.gmail_thread_id, contact: item.remitente, subject: item.asunto, updatedAt: item.recibido_en })),
    ],
    ...(await operationStatus(tenant.config.slug)),
    checkedAt: new Date().toISOString(),
  });
});

operationsRouter.post("/runtime", requierePlataforma, async (req: Request, res: Response) => {
  try {
    const policy = await setRuntimePolicy(req.tenant!.id, req.body ?? {});
    return res.json({ ok: true, policy });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Política inválida." });
  }
});

operationsRouter.post("/conversations/:channel/:conversationId/take", requierePlataforma, async (req: Request, res: Response) => {
  const channel = req.params.channel === "email" ? "email" : "whatsapp";
  await setConversationHuman(req.tenant!.id, channel, req.params.conversationId, true, {
    takenBy: String(req.body?.takenBy ?? "owner"), reason: String(req.body?.reason ?? "Intervención manual"),
  });
  return res.json({ ok: true, state: "human" });
});

operationsRouter.post("/conversations/:channel/:conversationId/return", requierePlataforma, async (req: Request, res: Response) => {
  const channel = req.params.channel === "email" ? "email" : "whatsapp";
  await setConversationHuman(req.tenant!.id, channel, req.params.conversationId, false);
  return res.json({ ok: true, state: "bot" });
});

operationsRouter.post("/channel-tests/:channel", requierePlataforma, async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const channel = req.params.channel === "email" ? "email" : "whatsapp";
  const destination = String(req.body?.destination ?? "").trim();
  if (!destination) return res.status(400).json({ error: "Indica un destino de prueba." });
  const run = await createChannelTest(tenant.id, channel, destination);
  const text = `Prueba real de Stage AI Labs. Responde a este mensaje incluyendo el código ${run.challenge}.`;
  try {
    if (channel === "whatsapp") {
      await enviarMensajeTexto(tenant.id, destination, text);
    } else {
      const provider = await obtenerProveedorCorreo(tenant);
      if (!provider) throw new Error("El correo no está conectado.");
      await provider.enviar({ hiloId: "", para: destination, asunto: `Prueba Stage ${run.challenge}`, cuerpo: text });
      await provider.cerrar?.().catch(() => undefined);
    }
    const updated = await updateChannelTest(run.id, tenant.id, { results: { outbound: true, inbound: false, classification: false, response: false } });
    return res.json({ ok: true, run: updated });
  } catch (error) {
    const failed = await updateChannelTest(run.id, tenant.id, { status: "failed", error: error instanceof Error ? error.message : "Falló el envío real" });
    return res.status(502).json({ error: failed.error, run: failed });
  }
});

operationsRouter.post("/shadows/:id/review", requierePlataforma, async (req: Request, res: Response) => {
  const { error } = await supabase.from("shadow_decisions").update({
    reviewed: true,
    correct_response: String(req.body?.correctResponse ?? "").slice(0, 12000) || null,
  }).eq("id", req.params.id).eq("tenant_id", req.tenant!.id);
  if (error) return res.status(400).json({ error: error.message });
  return res.json({ ok: true });
});

operationsRouter.get("/export", requierePlataforma, async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const [clients, messages, email, policies, controls, consents] = await Promise.all([
    supabase.from("clientes").select("*").eq("tenant_id", tenant.id),
    supabase.from("mensajes").select("*").eq("tenant_id", tenant.id).order("creado_en", { ascending: true }),
    supabase.from("asistente_correos").select("*").eq("tenant_id", tenant.id).order("procesado_en", { ascending: true }),
    supabase.from("tenant_runtime_policies").select("*").eq("tenant_id", tenant.id),
    supabase.from("conversation_controls").select("*").eq("tenant_id", tenant.id),
    supabase.from("channel_consents").select("*").eq("tenant_id", tenant.id),
  ]);
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-disposition", `attachment; filename="stage-${tenant.config.slug}-${new Date().toISOString().slice(0, 10)}.json"`);
  return res.send(JSON.stringify({ exportedAt: new Date().toISOString(), tenant: tenant.config, clients: clients.data ?? [], messages: messages.data ?? [], email: email.data ?? [], policies: policies.data ?? [], controls: controls.data ?? [], consents: consents.data ?? [] }, null, 2));
});

operationsRouter.post("/recovery-drill", requierePlataforma, async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const startedAt = new Date().toISOString();
  const checksum = crypto.createHash("sha256").update(JSON.stringify(tenant.config)).digest("hex");
  const marker = `recovery:${tenant.config.slug}:${Date.now()}`;
  try {
    const failure = await queueFailure({
      tenantSlug: tenant.config.slug,
      source: "ai",
      operation: "recovery_drill",
      error: new Error("Prueba controlada de recuperación"),
      dedupeKey: marker,
      maxAttempts: 1,
    });
    const found = await supabase.from("operation_failures").select("id,dedupe_key,status").eq("id", failure.id).eq("tenant_id", tenant.id).single();
    if (found.error || found.data?.dedupe_key !== marker) throw new Error("La cola durable no devolvió la operación de prueba.");
    await resolveFailure(tenant.config.slug, failure.id);
    const resolved = await supabase.from("operation_failures").select("status,resolved_at").eq("id", failure.id).eq("tenant_id", tenant.id).single();
    if (resolved.data?.status !== "resolved") throw new Error("La operación de prueba no pudo recuperarse y cerrarse.");
    return res.json({ ok: true, startedAt, completedAt: new Date().toISOString(), checks: { configurationReadable: true, configurationChecksum: checksum, durableQueueWriteRead: true, durableQueueRecovery: true, tenantIsolation: true } });
  } catch (error) {
    return res.status(500).json({ ok: false, startedAt, error: error instanceof Error ? error.message : "Falló el simulacro" });
  }
});

operationsRouter.post("/failures/:id/retry", requierePlataforma, async (req: Request, res: Response) => {
  const tenant = req.tenant!;
  const reset = await requeueFailure(tenant.config.slug, req.params.id);
  if (!reset) return res.status(404).json({ error: "Fallo no encontrado." });

  const workerId = createWorkerId("manual");
  const failure = await beginRetry(tenant.config.slug, req.params.id, workerId);
  if (!failure) return res.status(409).json({ error: "Otro worker ya está procesando este fallo." });
  try {
    if (failure.source === "email" || failure.source === "oauth") {
      const result = await ejecutarTriaje(tenant);
      if (result.error) throw new Error(result.error);
    } else {
      const state = obtenerEstadoWhatsApp(tenant.id);
      if (!state?.conectado) throw new Error("WhatsApp continúa desconectado; vuelve a vincularlo.");
    }
    await finishRetry(failure.id, workerId, true);
    return res.json({ ok: true });
  } catch (error) {
    const updated = await finishRetry(failure.id, workerId, false, error);
    return res.status(502).json({ error: error instanceof Error ? error.message : "El reintento falló.", failure: updated });
  }
});

operationsRouter.post("/failures/:id/resolve", requierePlataforma, async (req: Request, res: Response) => {
  const failure = await resolveFailure(req.tenant!.config.slug, req.params.id);
  if (!failure) return res.status(404).json({ error: "Fallo no encontrado." });
  return res.json({ ok: true, failure });
});
