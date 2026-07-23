import type { Tenant } from "../../../lib/tenants.js";
import { crearProveedorGmail } from "./gmail.js";
import { crearProveedorImap } from "./imap.js";
import { crearProveedorMicrosoft } from "./microsoft.js";
import type { EmailProvider, ProveedorCorreo } from "./tipos.js";

export * from "./tipos.js";

/**
 * Punto único donde se decide qué adaptador usar. El resto del asistente
 * (triaje, rutas, clasificador) no sabe ni tiene por qué saber cuál es.
 *
 * Agregar un proveedor nuevo = un adaptador que implemente EmailProvider +
 * una línea aquí.
 */

const FABRICAS: Record<ProveedorCorreo, (tenantId: string) => Promise<EmailProvider | null>> = {
  gmail: crearProveedorGmail,
  microsoft: crearProveedorMicrosoft,
  imap: crearProveedorImap,
};

/** Nombre legible del proveedor, para el dashboard y los mensajes de error. */
export const NOMBRE_PROVEEDOR: Record<ProveedorCorreo, string> = {
  gmail: "Gmail / Google Workspace",
  microsoft: "Microsoft / Outlook",
  imap: "Correo corporativo (IMAP)",
};

/**
 * Devuelve el proveedor de correo conectado de un tenant, o null si su bot no
 * es asistente o la cuenta todavía no está autorizada.
 */
export async function obtenerProveedorCorreo(tenant: Tenant): Promise<EmailProvider | null> {
  const asistente = tenant.config.asistente;
  if (!asistente) return null;
  return FABRICAS[asistente.proveedor](tenant.id);
}
