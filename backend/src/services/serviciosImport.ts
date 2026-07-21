import * as XLSX from "xlsx";
import { supabase } from "../lib/supabase.js";

/**
 * Importador GENÉRICO de catálogo desde Excel/CSV. A diferencia del
 * inventario de piezas específico de reparación de celulares (que tenía
 * parsers a medida del formato de un cliente en particular), este espera
 * columnas simples que cualquier negocio puede llenar:
 *
 *   nombre* | categoria | descripcion | precio* | moneda | stock | garantia_dias | sku | disponible
 *
 * (*obligatorias). Empareja por (tenant_id, nombre) al re-subir: actualiza
 * precio/descripcion/stock de las filas que ya existen, inserta las nuevas.
 */

export interface ResultadoImportacion {
  archivo: string;
  filasLeidas: number;
  insertadas: number;
  actualizadas: number;
  descartadas: number;
  errores: string[];
}

interface FilaServicio {
  nombre: string;
  categoria?: string;
  descripcion?: string;
  precio: number;
  moneda?: string;
  stock?: number;
  garantia_dias?: number;
  sku?: string;
  disponible?: boolean;
}

function normClave(s: string): string {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function campo(fila: Record<string, any>, ...nombres: string[]): any {
  const claves = Object.keys(fila);
  for (const objetivo of nombres.map(normClave)) {
    const clave = claves.find((k) => normClave(k) === objetivo);
    if (clave && String(fila[clave]).trim() !== "") return fila[clave];
  }
  return undefined;
}

function aNumero(raw: any): number {
  const s = String(raw ?? "").trim();
  if (!s) return NaN;
  return Number(s.replace(/[^\d.-]/g, ""));
}

function aBooleano(raw: any, porDefecto: boolean): boolean {
  if (raw === undefined || String(raw).trim() === "") return porDefecto;
  const v = String(raw).toLowerCase().trim();
  return ["si", "sí", "true", "1", "yes", "disponible"].includes(v);
}

function leerFilas(hoja: XLSX.WorkSheet): Record<string, any>[] {
  return XLSX.utils.sheet_to_json(hoja, { defval: "", blankrows: false });
}

function normalizarFila(fila: Record<string, any>): FilaServicio | null {
  const nombre = String(campo(fila, "nombre", "producto", "servicio", "name") ?? "").trim();
  const precio = aNumero(campo(fila, "precio", "price", "costo"));
  if (!nombre || !Number.isFinite(precio) || precio < 0) return null;

  const stockRaw = campo(fila, "stock", "existencia", "cantidad", "qty");
  const garantiaRaw = campo(fila, "garantia_dias", "garantia", "warranty");
  return {
    nombre,
    categoria: campo(fila, "categoria", "category") ? String(campo(fila, "categoria", "category")) : undefined,
    descripcion: campo(fila, "descripcion", "description") ? String(campo(fila, "descripcion", "description")) : undefined,
    precio,
    moneda: campo(fila, "moneda", "currency") ? String(campo(fila, "moneda", "currency")) : undefined,
    stock: stockRaw !== undefined ? Number(stockRaw) || 0 : undefined,
    garantia_dias: garantiaRaw !== undefined ? Number(garantiaRaw) || undefined : undefined,
    sku: campo(fila, "sku", "codigo", "code") ? String(campo(fila, "sku", "codigo", "code")) : undefined,
    disponible: aBooleano(campo(fila, "disponible", "activo", "available"), true),
  };
}

export interface ResultadoPreciosStock {
  archivo: string;
  filasLeidas: number;
  actualizadas: number;
  noEncontradas: number;
  descartadas: number;
  errores: string[];
}

/**
 * Actualización SEGURA de solo precios y/o stock. A diferencia del importador
 * de catálogo completo (que sobrescribe descripción, categoría, etc. con lo que
 * traiga el archivo), esta SOLO toca los campos precio/stock que vengan en cada
 * fila — nunca borra el resto. No inserta productos nuevos: empareja por nombre
 * con los que ya existen. Pensada para el drop rápido de "precios y stock".
 */
export async function procesarPreciosStock(
  tenantId: string,
  file: Express.Multer.File,
): Promise<ResultadoPreciosStock> {
  const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    throw new Error(`Formato .${ext} no soportado. Sube Excel (.xlsx/.xls) o CSV.`);
  }

  const libro = XLSX.read(file.buffer, { type: "buffer" });
  const filasCrudas = leerFilas(libro.Sheets[libro.SheetNames[0]]);

  const resultado: ResultadoPreciosStock = {
    archivo: file.originalname,
    filasLeidas: filasCrudas.length,
    actualizadas: 0,
    noEncontradas: 0,
    descartadas: 0,
    errores: [],
  };

  // Parseamos cada fila: nombre (obligatorio) + al menos uno de precio/stock.
  interface CambioPS {
    nombre: string;
    precio?: number;
    stock?: number;
  }
  const cambios: CambioPS[] = [];
  for (const fila of filasCrudas) {
    const nombre = String(campo(fila, "nombre", "producto", "servicio", "name") ?? "").trim();
    const precioRaw = campo(fila, "precio", "price", "costo");
    const stockRaw = campo(fila, "stock", "existencia", "cantidad", "qty");
    const precio = precioRaw !== undefined ? aNumero(precioRaw) : undefined;
    const stock = stockRaw !== undefined ? aNumero(stockRaw) : undefined;
    const tienePrecio = precio !== undefined && Number.isFinite(precio) && precio >= 0;
    const tieneStock = stock !== undefined && Number.isFinite(stock) && stock >= 0;
    if (!nombre || (!tienePrecio && !tieneStock)) {
      resultado.descartadas++;
      continue;
    }
    cambios.push({
      nombre,
      precio: tienePrecio ? precio : undefined,
      stock: tieneStock ? Math.trunc(stock as number) : undefined,
    });
  }

  if (cambios.length === 0) {
    resultado.errores.push(
      "No reconocí filas válidas. Se espera: nombre (obligatorio) y al menos precio o stock.",
    );
    return resultado;
  }

  const { data: existentes, error: errorExistentes } = await supabase
    .from("servicios")
    .select("id, nombre")
    .eq("tenant_id", tenantId);
  if (errorExistentes) throw errorExistentes;

  const indice = new Map<string, string>();
  for (const s of existentes ?? []) indice.set(normClave(s.nombre), s.id);

  for (const cambio of cambios) {
    const id = indice.get(normClave(cambio.nombre));
    if (!id) {
      resultado.noEncontradas++;
      if (resultado.errores.length < 10) {
        resultado.errores.push(`No existe en el catálogo: "${cambio.nombre}" (súbelo primero).`);
      }
      continue;
    }
    // Solo los campos presentes — jamás sobrescribimos descripción/categoría/etc.
    const patch: Record<string, number> = {};
    if (cambio.precio !== undefined) patch.precio = cambio.precio;
    if (cambio.stock !== undefined) patch.stock = cambio.stock;

    const { error } = await supabase.from("servicios").update(patch).eq("id", id);
    if (error) {
      if (resultado.errores.length < 10) resultado.errores.push(`${cambio.nombre}: ${error.message}`);
    } else {
      resultado.actualizadas++;
    }
  }

  return resultado;
}

/** Procesa un Excel/CSV y hace upsert del catálogo de un tenant. */
export async function procesarArchivoCatalogo(tenantId: string, file: Express.Multer.File): Promise<ResultadoImportacion> {
  const ext = (file.originalname.split(".").pop() ?? "").toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(ext)) {
    throw new Error(`Formato .${ext} no soportado. Sube Excel (.xlsx/.xls) o CSV.`);
  }

  const libro = XLSX.read(file.buffer, { type: "buffer" });
  const filasCrudas = leerFilas(libro.Sheets[libro.SheetNames[0]]);
  const filas = filasCrudas.map(normalizarFila).filter((f): f is FilaServicio => f !== null);

  const resultado: ResultadoImportacion = {
    archivo: file.originalname,
    filasLeidas: filasCrudas.length,
    insertadas: 0,
    actualizadas: 0,
    descartadas: filasCrudas.length - filas.length,
    errores: [],
  };
  if (filas.length === 0) {
    resultado.errores.push(
      "No reconocí filas válidas. Columnas esperadas: nombre, precio (obligatorias); categoria, descripcion, moneda, stock, garantia_dias, sku, disponible (opcionales).",
    );
    return resultado;
  }

  const { data: existentes, error: errorExistentes } = await supabase
    .from("servicios")
    .select("id, nombre")
    .eq("tenant_id", tenantId);
  if (errorExistentes) throw errorExistentes;

  const indice = new Map<string, string>();
  for (const s of existentes ?? []) indice.set(normClave(s.nombre), s.id);

  const nuevas: FilaServicio[] = [];
  const actualizar: { id: string; fila: FilaServicio }[] = [];
  for (const fila of filas) {
    const id = indice.get(normClave(fila.nombre));
    if (id) actualizar.push({ id, fila });
    else nuevas.push(fila);
  }

  if (nuevas.length > 0) {
    const { error } = await supabase.from("servicios").insert(
      nuevas.map((f) => ({
        tenant_id: tenantId,
        nombre: f.nombre,
        categoria: f.categoria ?? null,
        descripcion: f.descripcion ?? null,
        precio: f.precio,
        moneda: f.moneda ?? "USD",
        stock: f.stock ?? null,
        garantia_dias: f.garantia_dias ?? null,
        sku: f.sku ?? null,
        disponible: f.disponible ?? true,
      })),
    );
    if (error) resultado.errores.push(`Error insertando nuevas filas: ${error.message}`);
    else resultado.insertadas = nuevas.length;
  }

  for (const { id, fila } of actualizar) {
    const { error } = await supabase
      .from("servicios")
      .update({
        precio: fila.precio,
        categoria: fila.categoria ?? null,
        descripcion: fila.descripcion ?? null,
        moneda: fila.moneda ?? "USD",
        stock: fila.stock ?? null,
        garantia_dias: fila.garantia_dias ?? null,
        disponible: fila.disponible ?? true,
      })
      .eq("id", id);
    if (error) {
      if (resultado.errores.length < 10) resultado.errores.push(`${fila.nombre}: ${error.message}`);
    } else {
      resultado.actualizadas++;
    }
  }

  return resultado;
}
