import { supabase } from "../../lib/supabase.js";
import type { Tenant } from "../../lib/tenants.js";
import type { Clasificacion, TareaExtraida } from "./clasificador.js";
import { obtenerProveedorCorreo, type CorreoEntrante } from "./proveedores/index.js";
import { construirDestinoSeguro } from "./seguridad.js";
import { validarParaEnvio } from "./validacion.js";

export type FollowupType = "calendar" | "reply" | "review" | "follow_up";

export interface EmailFollowup {
  id: string;
  tenant_id: string;
  thread_id: string;
  recipient: string;
  subject: string;
  task_type: FollowupType;
  title: string;
  notes: string;
  due_at: string | null;
  status: "pending_owner" | "ready_to_reply" | "completed" | "cancelled";
  context: Array<{ messageId: string; receivedAt: string; summary: string }>;
  draft_reply: string | null;
  owner_note: string | null;
  updated_at: string;
}

const FUTURE_PROMISE = /\b(voy a (?:revisar|verificar|consultar)|vamos a (?:revisar|verificar|consultar)|le informar[ée]|te informar[ée]|dar[ée] seguimiento|me comunicar[ée]|i(?:'ll| will) (?:check|review|verify|get back)|we(?:'ll| will) (?:check|review|verify|get back))\b/i;
const CALENDAR_REQUEST = /\b(agenda|calendar|calendario|disponibilidad|available|availability|reuni[oó]n|meeting|google meet|cita|appointment)\b/i;

export function promisesFutureAction(text: string): boolean {
  return FUTURE_PROMISE.test(text);
}

export function inferFollowupType(task: TareaExtraida | null, correo: Pick<CorreoEntrante, "cuerpo" | "encabezados">): FollowupType {
  if (task?.tipo) return task.tipo;
  const source = `${correo.encabezados.subject}\n${correo.cuerpo}`;
  return CALENDAR_REQUEST.test(source) ? "calendar" : "follow_up";
}

function safeDueAt(value: string | null): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function followupRequired(clasificacion: Clasificacion, correo: CorreoEntrante): boolean {
  return Boolean(
    clasificacion.tarea ||
    promisesFutureAction(clasificacion.borrador?.cuerpo ?? "") ||
    (clasificacion.requiereAccion && CALENDAR_REQUEST.test(`${correo.encabezados.subject}\n${correo.cuerpo}`)),
  );
}

/** Crea o amplía el pendiente activo del mismo hilo. */
export async function rememberEmailFollowup(
  tenant: Tenant,
  correo: CorreoEntrante,
  clasificacion: Clasificacion,
): Promise<{ followup: EmailFollowup; created: boolean } | null> {
  if (!followupRequired(clasificacion, correo)) return null;
  const recipient = correo.encabezados.replyTo || correo.encabezados.from;
  const task = clasificacion.tarea;
  const type = inferFollowupType(task, correo);
  const summary = (task?.notas || clasificacion.justificacion || correo.encabezados.subject).slice(0, 1000);
  const entry = { messageId: correo.id, receivedAt: correo.recibidoEn, summary };

  const { data: existing } = await supabase
    .from("email_followups")
    .select("*")
    .eq("tenant_id", tenant.id)
    .eq("thread_id", correo.hiloId)
    .in("status", ["pending_owner", "ready_to_reply"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const context = [...(Array.isArray(existing.context) ? existing.context : []), entry].slice(-20);
    const { data, error } = await supabase.from("email_followups").update({
      source_message_id: correo.id,
      recipient,
      message_id: correo.messageId ?? null,
      title: task?.titulo || existing.title,
      notes: summary,
      task_type: type,
      due_at: safeDueAt(task?.vence ?? null) ?? existing.due_at,
      draft_reply: clasificacion.borrador?.cuerpo ?? existing.draft_reply,
      context,
      last_message_at: correo.recibidoEn,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id).eq("tenant_id", tenant.id).select("*").single();
    if (error) throw error;
    return { followup: data as EmailFollowup, created: false };
  }

  const { data, error } = await supabase.from("email_followups").insert({
    tenant_id: tenant.id,
    thread_id: correo.hiloId,
    source_message_id: correo.id,
    recipient,
    subject: correo.encabezados.subject,
    message_id: correo.messageId ?? null,
    task_type: type,
    title: task?.titulo || `Dar seguimiento: ${correo.encabezados.subject}`,
    notes: summary,
    due_at: safeDueAt(task?.vence ?? null),
    context: [entry],
    draft_reply: clasificacion.borrador?.cuerpo ?? null,
    last_message_at: correo.recibidoEn,
  }).select("*").single();
  if (error) throw error;
  return { followup: data as EmailFollowup, created: true };
}

export async function listEmailFollowups(tenantId: string): Promise<EmailFollowup[]> {
  const { data, error } = await supabase.from("email_followups").select("*")
    .eq("tenant_id", tenantId)
    .in("status", ["pending_owner", "ready_to_reply"])
    .order("updated_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as EmailFollowup[];
}

export async function resolveEmailFollowup(tenantId: string, id: string, resolution = "Resuelto por el dueño"): Promise<void> {
  const { error } = await supabase.from("email_followups").update({
    status: "completed", resolution: resolution.slice(0, 2000), completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id).eq("tenant_id", tenantId);
  if (error) throw error;
}

/** Responde únicamente al destinatario y al hilo guardados; el frontend no puede cambiarlos. */
export async function replyEmailFollowup(tenant: Tenant, id: string, responseText: string): Promise<void> {
  const body = responseText.trim();
  const validation = validarParaEnvio(body);
  if (!body || !validation.seguro) throw new Error(validation.motivo || "La respuesta no es segura para enviar.");
  const { data: row, error } = await supabase.from("email_followups").select("*")
    .eq("id", id).eq("tenant_id", tenant.id).in("status", ["pending_owner", "ready_to_reply"]).single();
  if (error || !row) throw new Error("El seguimiento ya no está pendiente.");
  const provider = await obtenerProveedorCorreo(tenant);
  if (!provider) throw new Error("El correo del cliente no está conectado.");
  try {
    const safe = construirDestinoSeguro({
      id: row.source_message_id,
      hiloId: row.thread_id,
      encabezados: { from: row.recipient, subject: row.subject },
      cuerpo: "",
      recibidoEn: row.last_message_at,
      messageId: row.message_id ?? undefined,
    }, body);
    if (!safe) throw new Error("No se pudo conservar de forma segura el destinatario original.");
    await provider.enviar(safe);
    await resolveEmailFollowup(tenant.id, id, "Respuesta enviada desde Owner Console");
  } finally {
    await provider.cerrar?.().catch(() => undefined);
  }
}

