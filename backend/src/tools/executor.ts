import { supabase, type Cliente, type EstadoCliente } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";
import { actualizarEstadoCliente } from "../services/clientes.js";
import {
  agendarCita,
  cancelarProximaCita,
  horarioDisponible,
  reprogramarProximaCita,
} from "../services/calendar.js";
import { notificarStockBajo } from "../services/notificaciones.js";
import { z } from "zod";

const isoDate = z.string().datetime({ offset: true });
const toolSchemas: Record<string, z.ZodTypeAny> = {
  consultar_catalogo: z.object({
    busqueda: z.string().trim().min(1).max(200),
    categoria: z.string().trim().max(100).optional(),
  }).strict(),
  etiquetar_cliente: z.object({
    estado: z.enum([
      "nuevo",
      "interesado",
      "cotizado",
      "agendado",
      "cliente",
      "perdido",
      "requiere_humano",
    ]),
    notas: z.string().trim().max(800).optional(),
    etiquetas: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  }).strict(),
  verificar_disponibilidad: z.object({
    inicio_iso: isoDate,
    duracion_minutos: z.number().int().min(15).max(480).optional(),
  }).strict(),
  agendar_cita: z.object({
    inicio_iso: isoDate,
    duracion_minutos: z.number().int().min(15).max(480).optional(),
    motivo: z.string().trim().min(2).max(300),
    cliente_confirmo: z.literal(true),
  }).strict(),
  reprogramar_cita: z.object({
    inicio_iso: isoDate,
    duracion_minutos: z.number().int().min(15).max(480).optional(),
    cliente_confirmo: z.literal(true),
  }).strict(),
  cancelar_cita: z.object({ cliente_confirmo: z.literal(true) }).strict(),
  registrar_consulta: z.object({
    categoria: z.enum([
      "precio",
      "disponibilidad",
      "horario_ubicacion",
      "cita",
      "envio",
      "pago",
      "garantia",
      "otra",
    ]),
    pregunta: z.string().trim().min(2).max(300),
    servicio_texto: z.string().trim().max(200).optional(),
    servicio_id: z.string().uuid().optional(),
  }).strict(),
};

function validateToolCall(
  nombre: string,
  input: Record<string, any>,
  tenant: Tenant,
) {
  if (
    tenant.config.behavior === "technical_support" &&
    [
      "verificar_disponibilidad",
      "agendar_cita",
      "reprogramar_cita",
      "cancelar_cita",
    ].includes(nombre)
  ) {
    throw new Error(
      "Esta función no está autorizada para un bot de soporte técnico.",
    );
  }
  const schema = toolSchemas[nombre];
  if (!schema) throw new Error("Herramienta no autorizada.");
  return schema.parse(input) as Record<string, any>;
}

/**
 * Ejecuta la tool solicitada por la IA y devuelve el resultado como string.
 * Los errores se devuelven como texto para que la IA pueda comunicarlos con
 * gracia al cliente.
 */
export async function ejecutarTool(
  nombre: string,
  input: Record<string, any>,
  tenant: Tenant,
  cliente: Cliente,
): Promise<{ resultado: string; esError: boolean }> {
  try {
    if (cliente.tenant_id !== tenant.id) {
      throw new Error("Aislamiento de tenant: el cliente no pertenece a este bot.");
    }
    input = validateToolCall(nombre, input, tenant);
    switch (nombre) {
      case "consultar_catalogo": {
        const busqueda = String(input.busqueda ?? "").trim();
        const columnas =
          "id, sku, nombre, categoria, precio, moneda, stock, garantia_dias, descripcion";

        let query = supabase
          .from("servicios")
          .select(columnas)
          .eq("tenant_id", tenant.id)
          .eq("disponible", true);

        if (input.categoria)
          query = query.ilike("categoria", `%${input.categoria}%`);

        const palabras = busqueda
          .toLowerCase()
          .split(/\s+/)
          .filter(
            (p) =>
              p.length > 1 &&
              !["de", "la", "el", "para", "una", "un", "del"].includes(p),
          );
        for (const palabra of palabras) {
          query = query.or(
            `nombre.ilike.%${palabra}%,categoria.ilike.%${palabra}%,descripcion.ilike.%${palabra}%`,
          );
        }

        const { data, error } = await query.order("nombre").limit(24);
        if (error) throw error;

        if (!data || data.length === 0) {
          return {
            resultado:
              "Sin resultados en el catálogo para esa búsqueda. No des un precio: ofrece escalar a un humano para confirmar disponibilidad.",
            esError: false,
          };
        }

        notificarStockBajo(tenant.id, data as any).catch((err) =>
          console.error("[tools] Error notificando stock bajo:", err),
        );

        return { resultado: JSON.stringify(data), esError: false };
      }

      case "etiquetar_cliente": {
        const estado = input.estado as EstadoCliente;
        const etiquetas: string[] = Array.isArray(input.etiquetas)
          ? [...input.etiquetas]
          : [];

        // Cuando la IA escala a un humano SÍ pausamos el bot (estado
        // 'requiere_humano'), para que un asesor tome el chat sin que el bot lo
        // siga contestando por encima. Esto ya NO deja al bot mudo para siempre:
        // la pausa está acotada a una ventana de 3h en baileys — si nadie
        // responde en ese tiempo y el cliente sigue escribiendo, el bot retoma.
        // Guardamos también la etiqueta para que el panel del cliente lo liste,
        // y actualizarEstadoCliente avisa al equipo al pasar a requiere_humano.
        if (
          estado === "requiere_humano" &&
          !etiquetas.includes("requiere_humano")
        ) {
          etiquetas.push("requiere_humano");
        }

        await actualizarEstadoCliente(tenant.id, cliente.id, estado, {
          etiquetas: etiquetas.length ? etiquetas : undefined,
          notas: input.notas,
        });
        return {
          resultado: `Cliente actualizado a estado '${estado}'.`,
          esError: false,
        };
      }

      case "verificar_disponibilidad": {
        const libre = await horarioDisponible(
          tenant,
          input.inicio_iso,
          input.duracion_minutos ?? 60,
        );
        return {
          resultado: libre
            ? "El horario está DISPONIBLE."
            : "El horario está OCUPADO. Propón otro horario cercano al cliente.",
          esError: false,
        };
      }

      case "agendar_cita": {
        if (input.cliente_confirmo !== true) {
          return {
            resultado:
              "No se creó la cita: falta confirmación explícita del cliente.",
            esError: true,
          };
        }
        const { citaId, googleEventId } = await agendarCita({
          tenant,
          clienteId: cliente.id,
          clienteNombre: cliente.nombre ?? cliente.telefono,
          clienteTelefono: cliente.telefono,
          inicioISO: input.inicio_iso,
          duracionMinutos: input.duracion_minutos ?? 60,
          motivo: input.motivo,
        });
        return {
          resultado: `Cita creada (id ${citaId}${googleEventId ? `, evento Google ${googleEventId}` : ", sin Google Calendar conectado"}).`,
          esError: false,
        };
      }

      case "reprogramar_cita": {
        const result = await reprogramarProximaCita(
          tenant,
          cliente.id,
          input.inicio_iso,
          input.duracion_minutos ?? 60,
        );
        return {
          resultado: `Cita reprogramada para ${result.inicio}.`,
          esError: false,
        };
      }

      case "cancelar_cita": {
        const result = await cancelarProximaCita(tenant, cliente.id);
        return {
          resultado: `Cita ${result.citaId} cancelada.`,
          esError: false,
        };
      }

      case "registrar_consulta": {
        const { error } = await supabase.from("consultas_analiticas").insert({
          tenant_id: tenant.id,
          cliente_id: cliente.id,
          categoria: input.categoria,
          pregunta: String(input.pregunta ?? "")
            .toLowerCase()
            .trim(),
          servicio_texto: input.servicio_texto || null,
          servicio_id: input.servicio_id || null,
        });
        if (error) throw error;
        return { resultado: "Consulta registrada.", esError: false };
      }

      default:
        return { resultado: `Tool desconocida: ${nombre}`, esError: true };
    }
  } catch (err: any) {
    console.error(`[tools] Error ejecutando ${nombre}:`, err);
    const safe =
      err instanceof z.ZodError
        ? "Los datos propuestos para la herramienta son inválidos o incompletos."
        : String(err?.message ?? "La operación no está autorizada.").slice(
            0,
            240,
          );
    return { resultado: `No se ejecutó ${nombre}: ${safe}`, esError: true };
  }
}
