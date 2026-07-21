import { supabase, type Cliente, type EstadoCliente } from "../lib/supabase.js";
import type { Tenant } from "../lib/tenants.js";
import { actualizarEstadoCliente } from "../services/clientes.js";
import { agendarCita, horarioDisponible } from "../services/calendar.js";
import { notificarStockBajo } from "../services/notificaciones.js";

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
    switch (nombre) {
      case "consultar_catalogo": {
        const busqueda = String(input.busqueda ?? "").trim();
        const columnas = "id, sku, nombre, categoria, precio, moneda, stock, garantia_dias, descripcion";

        let query = supabase
          .from("servicios")
          .select(columnas)
          .eq("tenant_id", tenant.id)
          .eq("disponible", true);

        if (input.categoria) query = query.ilike("categoria", `%${input.categoria}%`);

        const palabras = busqueda
          .toLowerCase()
          .split(/\s+/)
          .filter((p) => p.length > 1 && !["de", "la", "el", "para", "una", "un", "del"].includes(p));
        for (const palabra of palabras) {
          query = query.or(`nombre.ilike.%${palabra}%,categoria.ilike.%${palabra}%,descripcion.ilike.%${palabra}%`);
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
        let estado = input.estado as EstadoCliente;
        const etiquetas: string[] = Array.isArray(input.etiquetas) ? [...input.etiquetas] : [];

        // El bot NUNCA debe silenciarse a sí mismo. Si la IA decide escalar a
        // un humano, levantamos la bandera `atencion_humana_pendiente` —que es
        // lo que lista el dashboard— pero NO ponemos el estado
        // 'requiere_humano', que apaga el bot. Solo una petición EXPLÍCITA del
        // cliente (detectada en baileys) puede pausarlo. Así, en una
        // conversación activa el bot sigue ayudando en vez de quedarse mudo
        // —que era justo el fallo del bot de Dominguez— y aun así el caso
        // queda visible para el equipo.
        let marcarAtencionPendiente = false;
        if (estado === "requiere_humano") {
          if (!etiquetas.includes("requiere_humano")) etiquetas.push("requiere_humano");
          // Conserva su etapa en el embudo; no lo mandamos al estado que muta.
          estado = cliente.estado === "nuevo" ? "interesado" : cliente.estado;
          marcarAtencionPendiente = true;
        }

        await actualizarEstadoCliente(tenant.id, cliente.id, estado, {
          etiquetas: etiquetas.length ? etiquetas : undefined,
          notas: input.notas,
          marcarAtencionPendiente,
        });
        return { resultado: `Cliente actualizado a estado '${estado}'.`, esError: false };
      }

      case "verificar_disponibilidad": {
        const libre = await horarioDisponible(tenant.id, input.inicio_iso, input.duracion_minutos ?? 60);
        return {
          resultado: libre
            ? "El horario está DISPONIBLE."
            : "El horario está OCUPADO. Propón otro horario cercano al cliente.",
          esError: false,
        };
      }

      case "agendar_cita": {
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

      case "registrar_consulta": {
        const { error } = await supabase.from("consultas_analiticas").insert({
          tenant_id: tenant.id,
          cliente_id: cliente.id,
          categoria: input.categoria,
          pregunta: String(input.pregunta ?? "").toLowerCase().trim(),
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
    return { resultado: `Error interno al ejecutar ${nombre}: ${err?.message ?? err}`, esError: true };
  }
}
