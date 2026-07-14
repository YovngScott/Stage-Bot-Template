import { supabase } from "../lib/supabase.js";

export interface Empleado {
  id: string;
  tenant_id: string;
  nombre: string;
  telefono: string;
  activo: boolean;
  creado_en: string;
}

const COLUMNAS = "id, tenant_id, nombre, telefono, activo, creado_en";

export async function listarEmpleados(tenantId: string): Promise<Empleado[]> {
  const { data, error } = await supabase
    .from("empleados")
    .select(COLUMNAS)
    .eq("tenant_id", tenantId)
    .order("creado_en");
  if (error) throw error;
  return data as Empleado[];
}

/** Normaliza a formato E.164 simple: solo dígitos, con "+" al inicio. */
function normalizarTelefono(telefono: string): string {
  const digitos = telefono.replace(/[^\d]/g, "");
  if (digitos.length < 10) throw new Error("Número inválido. Escribe el número completo con código de país.");
  return "+" + digitos;
}

export async function crearEmpleado(tenantId: string, nombre: string, telefono: string): Promise<Empleado> {
  const nombreLimpio = nombre.trim();
  if (!nombreLimpio) throw new Error("Falta el nombre del empleado.");

  const { data, error } = await supabase
    .from("empleados")
    .insert({ tenant_id: tenantId, nombre: nombreLimpio, telefono: normalizarTelefono(telefono) })
    .select(COLUMNAS)
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Ya hay un empleado con ese número.");
    throw error;
  }
  return data as Empleado;
}

export async function actualizarEmpleado(
  id: string,
  cambios: { nombre?: string; telefono?: string; activo?: boolean },
): Promise<Empleado> {
  const update: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) update.nombre = cambios.nombre.trim();
  if (cambios.telefono !== undefined) update.telefono = normalizarTelefono(cambios.telefono);
  if (cambios.activo !== undefined) update.activo = cambios.activo;

  const { data, error } = await supabase.from("empleados").update(update).eq("id", id).select(COLUMNAS).single();
  if (error) {
    if (error.code === "23505") throw new Error("Ya hay un empleado con ese número.");
    throw error;
  }
  return data as Empleado;
}

export async function eliminarEmpleado(id: string): Promise<void> {
  const { error } = await supabase.from("empleados").delete().eq("id", id);
  if (error) throw error;
}
