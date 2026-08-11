import test from "node:test";
import assert from "node:assert/strict";
import { attachmentRisk } from "./email-safety.js";
import type { CorreoEntrante } from "./proveedores/index.js";

function email(adjuntos: CorreoEntrante["adjuntos"]): CorreoEntrante {
  return { id: "1", hiloId: "h", encabezados: { from: "a@b.com", subject: "x" }, cuerpo: "hola", recibidoEn: new Date().toISOString(), adjuntos };
}
test("retiene ejecutables aunque el MIME mienta", () => {
  assert.equal(attachmentRisk(email([{ nombre: "factura.exe", mimeType: "application/pdf", tamano: 10 }])).risky, true);
});
test("retiene adjuntos mayores de 20 MiB", () => {
  assert.equal(attachmentRisk(email([{ nombre: "video.mp4", mimeType: "video/mp4", tamano: 21 * 1024 * 1024 }])).risky, true);
});
test("permite metadatos de PDF pequeño", () => {
  assert.equal(attachmentRisk(email([{ nombre: "factura.pdf", mimeType: "application/pdf", tamano: 500_000 }])).risky, false);
});
