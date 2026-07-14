import { Router, type Request, type Response } from "express";
import { requiereAdmin } from "../lib/adminAuth.js";
import { listarEmpleados, crearEmpleado, actualizarEmpleado, eliminarEmpleado } from "../services/empleados.js";

export const empleadosRouter = Router({ mergeParams: true });

/** GET /api/:slug/empleados */
empleadosRouter.get("/", requiereAdmin, async (req: Request, res: Response) => {
  try {
    res.json(await listarEmpleados(req.tenant!.id));
  } catch (err: any) {
    console.error("[empleados] Error listando:", err);
    res.status(500).json({ error: "No se pudo cargar la lista de empleados." });
  }
});

/** POST /api/:slug/empleados — body: { nombre, telefono } */
empleadosRouter.post("/", requiereAdmin, async (req: Request, res: Response) => {
  const nombre = String(req.body?.nombre ?? "");
  const telefono = String(req.body?.telefono ?? "");
  try {
    const empleado = await crearEmpleado(req.tenant!.id, nombre, telefono);
    res.status(201).json(empleado);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "No se pudo crear el empleado." });
  }
});

/** PATCH /api/:slug/empleados/:id */
empleadosRouter.patch("/:id", requiereAdmin, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  try {
    const empleado = await actualizarEmpleado(id, {
      nombre: req.body?.nombre,
      telefono: req.body?.telefono,
      activo: req.body?.activo,
    });
    res.json(empleado);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? "No se pudo actualizar el empleado." });
  }
});

/** DELETE /api/:slug/empleados/:id */
empleadosRouter.delete("/:id", requiereAdmin, async (req: Request, res: Response) => {
  const id = String(req.params.id ?? "");
  try {
    await eliminarEmpleado(id);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[empleados] Error eliminando:", err);
    res.status(500).json({ error: "No se pudo eliminar el empleado." });
  }
});
