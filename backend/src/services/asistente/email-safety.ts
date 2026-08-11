import type { CorreoEntrante } from "./proveedores/index.js";

const DANGEROUS_EXTENSIONS = new Set([
  "exe", "com", "bat", "cmd", "ps1", "vbs", "js", "jse", "jar", "msi",
  "scr", "hta", "lnk", "iso", "img", "dll", "reg", "chm",
]);
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface AttachmentRisk { risky: boolean; reason: string | null }

export function attachmentRisk(correo: CorreoEntrante): AttachmentRisk {
  for (const item of correo.adjuntos ?? []) {
    const extension = item.nombre.toLowerCase().split(".").pop() || "";
    if (DANGEROUS_EXTENSIONS.has(extension)) {
      return { risky: true, reason: `Adjunto potencialmente peligroso: ${item.nombre}` };
    }
    if (item.tamano > MAX_ATTACHMENT_BYTES) {
      return { risky: true, reason: `Adjunto demasiado grande: ${item.nombre}` };
    }
  }
  return { risky: false, reason: null };
}
