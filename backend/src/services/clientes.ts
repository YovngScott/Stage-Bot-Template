import { supabase, type Cliente, type EstadoCliente, type Mensaje } from "../lib/supabase.js";
import { notificarEmpleados } from "./notificaciones.js";

const COLUMNAS_CLIENTE =
  "id, tenant_id, telefono, nombre, estado, etiquetas, notas, solicito_humano_en, atendido_en, atencion_humana_pendiente";

/** Busca un cliente por teléfono DENTRO de un tenant, o lo crea si es su primer contacto. */
export async function obtenerOCrearCliente(tenantId: string, telefono: string, nombre?: string): Promise<Cliente> {
  const { data: existente, error: errorBusqueda } = await supabase
    .from("clientes")
    .select(COLUMNAS_CLIENTE)
    .eq("tenant_id", tenantId)
    .eq("telefono", telefono)
    .maybeSingle();

  if (errorBusqueda) throw errorBusqueda;

  if (existente) {
    await supabase
      .from("clientes")
      .update({ ultimo_contacto: new Date().toISOString(), ...(nombre && !existente.nombre ? { nombre } : {}) })
      .eq("id", existente.id);
    return existente as Cliente;
  }

  const { data: nuevo, error: errorInsert } = await supabase
    .from("clientes")
    .insert({ tenant_id: tenantId, telefono, nombre: nombre ?? null })
    .select(COLUMNAS_CLIENTE)
    .single();

  if (errorInsert) throw errorInsert;
  return nuevo as Cliente;
}

export async function actualizarEstadoCliente(
  tenantId: string,
  clienteId: string,
  estado: EstadoCliente,
  opciones?: {
    etiquetas?: string[];
    notas?: string;
    /**
     * Marca el caso como pendiente en el dashboard SIN tocar `estado`, o sea
     * sin silenciar al bot. Es lo que usa la IA al escalar: el equipo ve el
     * caso, pero la conversación sigue atendida mientras tanto.
     */
    marcarAtencionPendiente?: boolean;
  },
): Promise<void> {
  const { data: actual, error: errorActual } = await supabase
    .from("clientes")
    .select("estado, telefono, nombre, atencion_humana_pendiente")
    .eq("id", clienteId)
    .maybeSingle();
  if (errorActual) throw errorActual;

  const cambios: Record<string, unknown> = { estado };
  if (opciones?.etiquetas) cambios.etiquetas = opciones.etiquetas;
  if (opciones?.notas) cambios.notas = opciones.notas;

  // Pausar el bot implica siempre estar pendiente de atención; lo contrario no.
  const pausaElBot = estado === "requiere_humano" && actual?.estado !== "requiere_humano";
  const quedaPendiente = pausaElBot || opciones?.marcarAtencionPendiente === true;

  if (pausaElBot) cambios.solicito_humano_en = new Date().toISOString();
  if (quedaPendiente) {
    cambios.atencion_humana_pendiente = true;
    // Sin marca de tiempo el dashboard no puede ordenar ni medir la espera.
    if (!actual?.atencion_humana_pendiente) cambios.solicito_humano_en = new Date().toISOString();
  }

  const { error } = await supabase.from("clientes").update(cambios).eq("id", clienteId);
  if (error) throw error;

  // Solo avisamos en la transición, para no repetir el aviso en cada mensaje.
  if (quedaPendiente && !actual?.atencion_humana_pendiente) {
    const identificacion = actual?.nombre ? `${actual.nombre} (${actual.telefono})` : actual?.telefono ?? "un cliente";
    const nota = opciones?.notas ? `\nNota: ${opciones.notas}` : "";
    const encabezado = pausaElBot
      ? `🔔 *Solicitud de atención humana*\n${identificacion} pidió hablar con un empleado. El bot quedó en pausa para este chat.`
      : `🔔 *Caso escalado por el bot*\n${identificacion} necesita seguimiento de una persona. El bot sigue atendiendo mientras tanto.`;
    notificarEmpleados(tenantId, `${encabezado}${nota}`).catch((err) =>
      console.error("[clientes] Error avisando solicitud de humano:", err),
    );
  }
}

/**
 * Cierra la solicitud de atención humana y devuelve el chat al bot.
 */
export async function marcarClienteAtendido(clienteId: string): Promise<boolean> {
  const { data: actual, error: errorActual } = await supabase
    .from("clientes")
    .select("estado, atencion_humana_pendiente")
    .eq("id", clienteId)
    .maybeSingle();
  if (errorActual) throw errorActual;
  if (!actual?.atencion_humana_pendiente) return false;

  const { data, error } = await supabase
    .from("clientes")
    .update({
      atencion_humana_pendiente: false,
      atendido_en: new Date().toISOString(),
      // Solo hay que "despausar" si el chat llegó a pausarse. Un caso que la
      // IA escaló nunca silenció al bot, así que conserva su etapa del embudo.
      ...(actual.estado === "requiere_humano" ? { estado: "interesado" } : {}),
    })
    .eq("id", clienteId)
    .eq("atencion_humana_pendiente", true)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data !== null;
}

/** Guarda un mensaje del historial. Devuelve el id insertado. */
export async function guardarMensaje(mensaje: {
  tenant_id: string;
  cliente_id: string;
  rol: Mensaje["rol"];
  contenido: string;
  wa_message_id?: string;
  tokens_entrada?: number;
  tokens_salida?: number;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from("mensajes")
    .insert(mensaje)
    .select("id")
    .maybeSingle();

  // 23505 = unique_violation: webhook duplicado, lo ignoramos.
  if (error) {
    if (error.code === "23505") return null;
    throw error;
  }
  return data?.id ?? null;
}

/** ¿Ya procesamos este mensaje de WhatsApp para este tenant? */
export async function mensajeYaProcesado(tenantId: string, waMessageId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("mensajes")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("wa_message_id", waMessageId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/**
 * Últimos N mensajes del cliente en orden cronológico, para el contexto de la
 * IA. Si se pasa `ventanaOculta` (la última solicitud de atención humana ya
 * resuelta), se excluyen los mensajes de ese intercambio.
 */
export async function obtenerHistorial(
  clienteId: string,
  ventanaOculta?: { desde: string | null; hasta: string | null },
  limite = 30,
): Promise<Mensaje[]> {
  const { data, error } = await supabase
    .from("mensajes")
    .select("id, tenant_id, cliente_id, rol, contenido, creado_en")
    .eq("cliente_id", clienteId)
    .order("creado_en", { ascending: false })
    .limit(limite);

  if (error) throw error;
  let mensajes = (data as Mensaje[]).reverse();

  if (ventanaOculta?.desde) {
    const desde = new Date(ventanaOculta.desde).getTime();
    const hasta = ventanaOculta.hasta ? new Date(ventanaOculta.hasta).getTime() : Date.now();
    mensajes = mensajes.filter((m) => {
      const t = new Date(m.creado_en).getTime();
      return t < desde || t > hasta;
    });
  }

  return mensajes;
}
