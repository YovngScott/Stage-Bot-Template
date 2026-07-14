import { supabase } from "../lib/supabase.js";
import { enviarMensajeTexto } from "./baileys.js";

/** Manda `mensaje` por WhatsApp a todos los empleados activos de ESTE tenant. */
export async function notificarEmpleados(tenantId: string, mensaje: string): Promise<void> {
  const { data, error } = await supabase
    .from("empleados")
    .select("telefono")
    .eq("tenant_id", tenantId)
    .eq("activo", true);
  if (error) {
    console.error("[notificaciones] Error leyendo empleados:", error);
    return;
  }
  if (!data || data.length === 0) return;

  await Promise.all(
    data.map((e) =>
      enviarMensajeTexto(tenantId, e.telefono, mensaje).catch((err) =>
        console.error(`[notificaciones] No se pudo avisar a ${e.telefono}:`, err),
      ),
    ),
  );
}

interface ServicioBajoStock {
  id: string;
  nombre: string;
  stock: number | null;
}

const UMBRAL_STOCK_BAJO = 3;
const ENFRIAMIENTO_MS = 60 * 60 * 1000; // no repetir la misma alerta antes de 1h
const ultimaAlertaPorServicio = new Map<string, number>();

/**
 * Avisa al equipo del tenant cuando un servicio/producto consultado por un
 * cliente tiene poco stock (≤3) o está agotado. Los negocios que no llevan
 * inventario (stock = null) simplemente no generan esta alerta.
 */
export async function notificarStockBajo(tenantId: string, servicios: ServicioBajoStock[]): Promise<void> {
  const ahora = Date.now();
  const aAvisar = servicios.filter((s) => {
    if (s.stock === null || s.stock > UMBRAL_STOCK_BAJO) return false;
    const ultima = ultimaAlertaPorServicio.get(s.id);
    if (ultima && ahora - ultima < ENFRIAMIENTO_MS) return false;
    ultimaAlertaPorServicio.set(s.id, ahora);
    return true;
  });
  if (aAvisar.length === 0) return;

  const lineas = aAvisar.map((s) => (s.stock === 0 ? `• ${s.nombre}: SIN STOCK` : `• ${s.nombre}: quedan ${s.stock}`));
  await notificarEmpleados(tenantId, `📦 *Alerta de inventario*\n${lineas.join("\n")}`);
}
