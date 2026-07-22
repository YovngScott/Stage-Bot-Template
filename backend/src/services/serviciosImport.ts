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
  const objetivos = nombres.map(normClave);

  // 1) Coincidencia exacta (ej. columna "Precio").
  for (const objetivo of objetivos) {
    const clave = claves.find((k) => normClave(k) === objetivo);
    if (clave && String(fila[clave]).trim() !== "") return fila[clave];
  }

  // 2) Coincidencia parcial: encabezados con texto extra (ej. "Precio
  // Unitario", "Nombre del producto", "Cantidad en stock") no calzan exacto
  // pero sí contienen la palabra clave — sin esto se descartaban filas
  // válidas solo porque el Excel del cliente no usa el nombre de columna
  // pelado.
  for (const objetivo of objetivos) {
    const clave = claves.find((k) => normClave(k).includes(objetivo));
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
  // Solo se llena cuando el archivo no era una lista plana (nombre/precio/
  // stock) sino una MATRIZ (modelo × tipo de pieza, común en negocios de
  // reparación de celulares) — ver extraerMatrizDeLibro más abajo. Como esas
  // combinaciones casi nunca existen ya en el catálogo, ese modo sí inserta
  // productos nuevos además de actualizar.
  insertadas?: number;
}

// ---------------------------------------------------------------------------
// Importador de MATRICES (modelo × tipo de pieza/precio). Algunos negocios
// (ej. reparación de celulares) no llevan una lista plana de productos sino
// una tabla donde las filas son modelos y las columnas son tipos de pieza o
// reparación, con el precio (o cantidad) en el cruce. Esto detecta ese
// patrón automáticamente cuando el parseo plano de arriba no encuentra nada,
// y genera un producto por cada combinación no vacía, ej.
// "iPhone 7 - Pantalla Original" = 3500.
// ---------------------------------------------------------------------------

const ALIAS_ETIQUETA = ["equipo", "modelo", "producto", "nombre", "item", "articulo", "tipo", "ano", "marca"];
const ALIAS_STOCK_COL = ["cantidad", "cantdad", "stock", "existencia", "qty", "inventario"];

type TipoColumna = "etiqueta" | "stock" | "precio" | "ignorar";

function clasificarColumna(headerTexto: string): TipoColumna {
  const norm = normClave(headerTexto);
  if (!norm) return "ignorar";
  if (ALIAS_ETIQUETA.some((a) => norm.includes(a))) return "etiqueta";
  if (ALIAS_STOCK_COL.some((a) => norm.includes(a))) return "stock";
  return "precio";
}

function puntuarFilaEncabezado(fila: unknown[]): number {
  let score = 0;
  for (const celda of fila) {
    if (celda === null || celda === undefined) continue;
    const texto = String(celda).trim();
    if (!texto || /^-?\d+([.,]\d+)?$/.test(texto)) continue; // vacío o puramente numérico: no cuenta
    const norm = normClave(texto);
    const esAlias = ALIAS_ETIQUETA.some((a) => norm.includes(a)) || ALIAS_STOCK_COL.some((a) => norm.includes(a));
    score += esAlias ? 2 : 1;
  }
  return score;
}

/** Encuentra la fila de encabezados dentro de las primeras 10 filas de la hoja. */
function detectarFilaEncabezado(filas: unknown[][]): number {
  let mejorIdx = -1;
  let mejorScore = 0;
  const limite = Math.min(filas.length, 10);
  for (let i = 0; i < limite; i++) {
    const s = puntuarFilaEncabezado(filas[i] ?? []);
    if (s > mejorScore) {
      mejorScore = s;
      mejorIdx = i;
    }
  }
  return mejorScore >= 2 ? mejorIdx : -1;
}

interface EntradaMatriz {
  nombre: string;
  precio?: number;
  stock?: number;
}

/** Colapsa saltos de línea/espacios repetidos de celdas de Excel con texto en varias líneas. */
function limpiarTexto(v: unknown): string {
  return String(v).replace(/\s+/g, " ").trim();
}

/** ¿El valor es utilizable para este tipo de columna? Un precio en 0 casi
 * siempre significa "no aplica" en estas matrices, no "gratis" — se
 * descarta para no ofrecerle al bot un precio falso. Un stock en 0 sí es
 * información real (agotado) y se conserva. */
function valorUtilizable(num: number, tipo: "stock" | "precio"): boolean {
  if (!Number.isFinite(num)) return false;
  return tipo === "stock" ? num >= 0 : num > 0;
}

function extraerDeHoja(filas: unknown[][]): EntradaMatriz[] {
  const idxEncabezado = detectarFilaEncabezado(filas);
  if (idxEncabezado === -1) return [];

  const encabezado = filas[idxEncabezado] ?? [];
  const tipos: TipoColumna[] = encabezado.map((celda) => {
    const texto = celda != null ? String(celda).trim() : "";
    return texto ? clasificarColumna(texto) : "ignorar";
  });

  const colsEtiqueta = tipos.reduce<number[]>((acc, t, i) => (t === "etiqueta" ? [...acc, i] : acc), []);
  const colsValor = tipos.reduce<number[]>(
    (acc, t, i) => (t === "stock" || t === "precio" ? [...acc, i] : acc),
    [],
  );
  if (colsEtiqueta.length === 0 || colsValor.length === 0) return [];

  // ¿Matriz ancha (pocas columnas de nombre + muchas de valor, ej. "MODELO"
  // + 20 tipos de reparación) o pares repetidos (grupos "Equipo"/"Cantidad"
  // uno tras otro, ej. inventario de piezas)? Si hay una columna de valor
  // ENTRE dos columnas de etiqueta, son pares repetidos.
  let intercalado = false;
  for (let i = 1; i < colsEtiqueta.length; i++) {
    const anterior = colsEtiqueta[i - 1];
    const actual = colsEtiqueta[i];
    if (colsValor.some((v) => v > anterior && v < actual)) {
      intercalado = true;
      break;
    }
  }

  const entradas: EntradaMatriz[] = [];

  if (!intercalado) {
    // Modo matriz ancha: un nombre base por fila (unión de las columnas de
    // etiqueta), un producto por cada columna de valor con dato.
    for (let r = idxEncabezado + 1; r < filas.length; r++) {
      const fila = filas[r] ?? [];
      const partesNombre = colsEtiqueta
        .map((c) => fila[c])
        .filter((v) => v != null && String(v).trim() !== "")
        .map((v) => limpiarTexto(v));
      if (partesNombre.length === 0) continue;
      const baseNombre = partesNombre.join(" ");

      for (const c of colsValor) {
        const crudo = fila[c];
        if (crudo === null || crudo === undefined || String(crudo).trim() === "") continue;
        const tipoValor = tipos[c] as "stock" | "precio";
        const num = aNumero(crudo);
        if (!valorUtilizable(num, tipoValor)) continue;
        const headerCol = limpiarTexto(encabezado[c]);
        const nombre = `${baseNombre} - ${headerCol}`;
        if (tipoValor === "stock") entradas.push({ nombre, stock: Math.trunc(num) });
        else entradas.push({ nombre, precio: num });
      }
    }
    return entradas;
  }

  // Modo pares repetidos: cada columna de etiqueta se empareja con la
  // siguiente columna de valor antes de la próxima etiqueta. La "categoría"
  // del grupo (si existe) se busca en las filas justo arriba del encabezado,
  // en esa misma columna (ej. el nombre de la categoría de pieza).
  interface Par {
    colEtiqueta: number;
    colValor: number;
    tipoValor: "stock" | "precio";
    categoria: string;
  }
  const pares: Par[] = [];
  for (let i = 0; i < colsEtiqueta.length; i++) {
    const colEtiqueta = colsEtiqueta[i];
    const siguienteEtiqueta = colsEtiqueta[i + 1] ?? Infinity;
    const colValor = colsValor.find((v) => v > colEtiqueta && v < siguienteEtiqueta);
    if (colValor === undefined) continue;

    let categoria = "";
    for (let up = idxEncabezado - 1; up >= Math.max(0, idxEncabezado - 4); up--) {
      const val = filas[up]?.[colEtiqueta];
      if (val != null && String(val).trim() !== "") {
        categoria = limpiarTexto(val);
        break;
      }
    }
    pares.push({ colEtiqueta, colValor, tipoValor: tipos[colValor] as "stock" | "precio", categoria });
  }

  for (let r = idxEncabezado + 1; r < filas.length; r++) {
    const fila = filas[r] ?? [];
    for (const par of pares) {
      const nombreCrudo = fila[par.colEtiqueta];
      if (nombreCrudo == null || String(nombreCrudo).trim() === "") continue;
      const nombreBase = limpiarTexto(nombreCrudo);
      const nombre = par.categoria ? `${par.categoria} - ${nombreBase}` : nombreBase;

      const crudoValor = fila[par.colValor];
      if (crudoValor === null || crudoValor === undefined || String(crudoValor).trim() === "") continue;
      const num = aNumero(crudoValor);
      if (!valorUtilizable(num, par.tipoValor)) continue;

      if (par.tipoValor === "stock") entradas.push({ nombre, stock: Math.trunc(num) });
      else entradas.push({ nombre, precio: num });
    }
  }
  return entradas;
}

export function extraerMatrizDeLibro(libro: XLSX.WorkBook): EntradaMatriz[] {
  const todas: EntradaMatriz[] = [];
  for (const nombreHoja of libro.SheetNames) {
    const hoja = libro.Sheets[nombreHoja];
    const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: null, blankrows: true }) as unknown[][];
    todas.push(...extraerDeHoja(filas));
  }
  return todas;
}

/**
 * A diferencia de la actualización plana (arriba), las combinaciones que
 * salen de una matriz casi nunca existen ya en el catálogo — así que este
 * modo SÍ inserta productos nuevos, además de actualizar los que calcen por
 * nombre en una re-subida.
 */
async function aplicarMatrizComoCatalogo(
  tenantId: string,
  archivoNombre: string,
  entradas: EntradaMatriz[],
): Promise<ResultadoPreciosStock> {
  const combinado = new Map<string, EntradaMatriz>();
  for (const e of entradas) {
    const clave = normClave(e.nombre);
    const existente = combinado.get(clave);
    if (existente) {
      if (e.precio !== undefined) existente.precio = e.precio;
      if (e.stock !== undefined) existente.stock = e.stock;
    } else {
      combinado.set(clave, { ...e });
    }
  }
  const items = Array.from(combinado.values());

  const resultado: ResultadoPreciosStock = {
    archivo: archivoNombre,
    filasLeidas: items.length,
    actualizadas: 0,
    noEncontradas: 0,
    descartadas: 0,
    errores: [],
    insertadas: 0,
  };

  const { data: existentes, error: errorExistentes } = await supabase
    .from("servicios")
    .select("id, nombre")
    .eq("tenant_id", tenantId);
  if (errorExistentes) throw errorExistentes;

  const indice = new Map<string, string>();
  for (const s of existentes ?? []) indice.set(normClave(s.nombre), s.id);

  const nuevos: EntradaMatriz[] = [];
  const actualizar: { id: string; item: EntradaMatriz }[] = [];
  for (const item of items) {
    const id = indice.get(normClave(item.nombre));
    if (id) actualizar.push({ id, item });
    else nuevos.push(item);
  }

  const TAMANO_LOTE = 500;
  for (let i = 0; i < nuevos.length; i += TAMANO_LOTE) {
    const lote = nuevos.slice(i, i + TAMANO_LOTE);
    const { error } = await supabase.from("servicios").insert(
      lote.map((it) => ({
        tenant_id: tenantId,
        nombre: it.nombre,
        precio: it.precio ?? 0,
        moneda: "USD",
        stock: it.stock ?? null,
        disponible: true,
      })),
    );
    if (error) {
      if (resultado.errores.length < 10) resultado.errores.push(`Error insertando lote: ${error.message}`);
    } else {
      resultado.insertadas = (resultado.insertadas ?? 0) + lote.length;
    }
  }

  for (const { id, item } of actualizar) {
    const patch: Record<string, number> = {};
    if (item.precio !== undefined) patch.precio = item.precio;
    if (item.stock !== undefined) patch.stock = item.stock;
    if (Object.keys(patch).length === 0) continue;

    const { error } = await supabase.from("servicios").update(patch).eq("id", id);
    if (error) {
      if (resultado.errores.length < 10) resultado.errores.push(`${item.nombre}: ${error.message}`);
    } else {
      resultado.actualizadas++;
    }
  }

  return resultado;
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
    const nombre = String(
      campo(fila, "nombre", "producto", "servicio", "name", "articulo", "item", "descripcion") ?? "",
    ).trim();
    const precioRaw = campo(fila, "precio", "price", "costo", "valor");
    const stockRaw = campo(fila, "stock", "existencia", "cantidad", "qty", "inventario");
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
    // No calzó el formato plano — puede que sea una MATRIZ (modelo × tipo de
    // pieza, común en reparación de celulares) en vez de una lista simple.
    // Se intenta detectarla automáticamente antes de rendirse.
    const entradasMatriz = extraerMatrizDeLibro(libro);
    if (entradasMatriz.length > 0) {
      return await aplicarMatrizComoCatalogo(tenantId, file.originalname, entradasMatriz);
    }
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
