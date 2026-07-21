import { supabase, type Cliente, type EstadoCliente, type Mensaje } from "../lib/supabase.js";
import { notificarEmpleados } from "./notificaciones.js";

const COLUMNAS_CLIENTE = "id, tenant_id, telefono, nombre, estado, etiquetas, notas, solicito_humano_en, atendido_en";

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
  opciones?: { etiquetas?: string[]; notas?: string },
): Promise<void> {
  const { data: actual, error: errorActual } = await supabase
    .from("clientes")
    .select("estado, telefono, nombre")
    .eq("id", clienteId)
    .maybeSingle();
  if (errorActual) throw errorActual;

  const cambios: Record<string, unknown> = { estado };
  if (opciones?.etiquetas) cambios.etiquetas = opciones.etiquetas;
  if (opciones?.notas) cambios.notas = opciones.notas;

  const pasaAHumano = estado === "requiere_humano" && actual?.estado !== "requiere_humano";
  if (pasaAHumano) cambios.solicito_humano_en = new Date().toISOString();

  const { error } = await supabase.from("clientes").update(cambios).eq("id", clienteId);
  if (error) throw error;

  if (pasaAHumano) {
    const identificacion = actual?.nombre ? `${actual.nombre} (${actual.telefono})` : actual?.telefono ?? "un cliente";
    const nota = opciones?.notas ? `\nNota: ${opciones.notas}` : "";
    notificarEmpleados(tenantId, `🔔 *Solicitud de atención humana*\n${identificacion} necesita hablar con un empleado.${nota}`).catch(
      (err) => console.error("[clientes] Error avisando solicitud de humano:", err),
    );
  }
}

/**
 * Cierra la solicitud de atención humana y devuelve el chat al bot.
 *
 * Un cliente puede necesitar atención por dos vías: (1) estado='requiere_humano'
 * (petición explícita que pausó el bot), o (2) la etiqueta 'requiere_humano'
 * que la IA agrega SIN pausar el bot. Al marcar atendido limpiamos AMBAS: si
 * el estado estaba en requiere_humano lo devolvemos a 'interesado' (des-mutea),
 * y en todos los casos quitamos la etiqueta para que salga del panel.
 */
export async function marcarClienteAtendido(clienteId: string): Promise<boolean> {
  const { data: actual, error: errorActual } = await supabase
    .from("clientes")
    .select("estado, etiquetas")
    .eq("id", clienteId)
    .maybeSingle();
  if (errorActual) throw errorActual;
  if (!actual) return false;

  const etiquetas: string[] = Array.isArray(actual.etiquetas) ? actual.etiquetas : [];
  const teniaEtiqueta = etiquetas.includes("requiere_humano");
  const teniaEstado = actual.estado === "requiere_humano";
  if (!teniaEtiqueta && !teniaEstado) return false; // no había nada que atender

  const cambios: Record<string, unknown> = {
    atendido_en: new Date().toISOString(),
    etiquetas: etiquetas.filter((e) => e !== "requiere_humano"),
  };
  if (teniaEstado) cambios.estado = "interesado";

  const { error } = await supabase.from("clientes").update(cambios).eq("id", clienteId);
  if (error) throw error;
  return true;
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
