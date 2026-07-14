import { Router, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { requiereAdmin } from "../lib/adminAuth.js";
import { generarDatosReporteDiario } from "../services/reportes.js";

export const reportesRouter = Router({ mergeParams: true });

/** GET /api/:slug/reportes/diario.pdf?fecha=YYYY-MM-DD */
reportesRouter.get("/diario.pdf", requiereAdmin, async (req: Request, res: Response) => {
  try {
    const tenant = req.tenant!;
    const fecha = req.query.fecha ? new Date(String(req.query.fecha)) : new Date();
    const datos = await generarDatosReporteDiario(tenant, fecha);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="reporte-${tenant.config.slug}-${datos.fecha}.pdf"`);

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(18).fillColor("#000").text(tenant.config.nombre);
    doc.fontSize(12).fillColor("#555").text(`Reporte diario — ${datos.fecha}`);
    doc.moveDown(1.5);

    doc.fillColor("#000").fontSize(13).text("Resumen del día");
    doc.fontSize(11).fillColor("#333");
    doc.text(`Clientes activos hoy: ${datos.clientesActivosHoy}`);
    doc.text(`Clientes nuevos hoy: ${datos.clientesNuevosHoy}`);
    doc.text(`Mensajes recibidos: ${datos.mensajesHoy}`);
    doc.text(`Chats esperando un empleado: ${datos.clientesRequierenHumano}`);
    doc.moveDown(1);

    doc.fillColor("#000").fontSize(13).text("Citas de hoy");
    doc.fontSize(11).fillColor("#333");
    if (datos.citasHoy.length === 0) {
      doc.text("Sin citas agendadas.");
    } else {
      for (const cita of datos.citasHoy) doc.text(`• ${cita.hora} — ${cita.cliente} (${cita.motivo})`);
    }
    doc.moveDown(1);

    doc.fillColor("#000").fontSize(13).text("Más preguntados");
    doc.fontSize(11).fillColor("#333");
    if (datos.serviciosMasPreguntados.length === 0) {
      doc.text("Sin datos.");
    } else {
      for (const s of datos.serviciosMasPreguntados) doc.text(`• ${s.servicio}: ${s.veces} veces`);
    }

    doc.end();
  } catch (err: any) {
    console.error("[reportes] Error generando PDF:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message ?? "Error generando el reporte." });
    }
  }
});
