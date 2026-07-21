import { Router, type Request, type Response } from "express";
import multer from "multer";
import { requiereAdmin } from "../lib/adminAuth.js";
import { supabase } from "../lib/supabase.js";
import { procesarArchivoCatalogo, procesarPreciosStock } from "../services/serviciosImport.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

export const serviciosRouter = Router({ mergeParams: true });

/** GET /api/:slug/servicios — catálogo actual (para revisar/editar en el dashboard). */
serviciosRouter.get("/", requiereAdmin, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from("servicios")
    .select("id, sku, nombre, categoria, descripcion, precio, moneda, stock, garantia_dias, disponible")
    .eq("tenant_id", req.tenant!.id)
    .order("nombre");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/** POST /api/:slug/servicios — crea un producto/servicio a mano. */
serviciosRouter.post("/", requiereAdmin, async (req: Request, res: Response) => {
  const { nombre, categoria, descripcion, precio, moneda, stock, garantia_dias, sku, disponible } = req.body ?? {};
  if (!nombre || !Number.isFinite(Number(precio))) {
    return res.status(400).json({ error: "Faltan campos obligatorios: nombre, precio." });
  }
  const { data, error } = await supabase
    .from("servicios")
    .insert({
      tenant_id: req.tenant!.id,
      nombre,
      categoria: categoria || null,
      descripcion: descripcion || null,
      precio: Number(precio),
      moneda: moneda || "USD",
      stock: stock === undefined || stock === null || stock === "" ? null : Number(stock),
      garantia_dias: garantia_dias || null,
      sku: sku || null,
      disponible: disponible ?? true,
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

/** PATCH /api/:slug/servicios/:id */
serviciosRouter.patch("/:id", requiereAdmin, async (req: Request, res: Response) => {
  const { error, data } = await supabase
    .from("servicios")
    .update(req.body ?? {})
    .eq("id", req.params.id)
    .eq("tenant_id", req.tenant!.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

/** DELETE /api/:slug/servicios/:id */
serviciosRouter.delete("/:id", requiereAdmin, async (req: Request, res: Response) => {
  const { error } = await supabase.from("servicios").delete().eq("id", req.params.id).eq("tenant_id", req.tenant!.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true });
});

/** POST /api/:slug/servicios/importar — Excel/CSV con el catálogo completo. */
serviciosRouter.post("/importar", requiereAdmin, upload.single("archivo"), async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: "Falta el archivo (campo 'archivo')." });
  try {
    const resultado = await procesarArchivoCatalogo(req.tenant!.id, req.file);
    res.json(resultado);
  } catch (err: any) {
    console.error("[servicios] Error procesando archivo:", err);
    res.status(400).json({ error: err?.message ?? "Error interno procesando el archivo." });
  }
});

/**
 * POST /api/:slug/servicios/precios-stock — actualización SEGURA de solo
 * precio y/o stock (no toca el resto de los campos ni inserta productos).
 */
serviciosRouter.post(
  "/precios-stock",
  requiereAdmin,
  upload.single("archivo"),
  async (req: Request, res: Response) => {
    if (!req.file) return res.status(400).json({ error: "Falta el archivo (campo 'archivo')." });
    try {
      const resultado = await procesarPreciosStock(req.tenant!.id, req.file);
      res.json(resultado);
    } catch (err: any) {
      console.error("[servicios] Error procesando precios/stock:", err);
      res.status(400).json({ error: err?.message ?? "Error interno procesando el archivo." });
    }
  },
);
