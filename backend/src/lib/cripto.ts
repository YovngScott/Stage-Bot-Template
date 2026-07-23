import crypto from "node:crypto";
import { config } from "./config.js";

/**
 * Cifrado simétrico para las credenciales de correo que NO son OAuth.
 *
 * Un OAuth token se revoca desde la consola del proveedor; una contraseña de
 * aplicación de IMAP/SMTP no: si se filtra la base, quien la tenga entra al
 * buzón del cliente. Por eso estas credenciales nunca se guardan en claro.
 *
 * AES-256-GCM: además de cifrar, autentica — si alguien manipula la fila en la
 * base, el descifrado falla en vez de devolver basura silenciosamente.
 */

const ALGORITMO = "aes-256-gcm";
const LARGO_IV = 12; // 96 bits, el recomendado para GCM

/** Deriva una llave de 32 bytes del secreto de entorno. */
function llave(): Buffer {
  const secreto = config.credenciales.secreto;
  if (!secreto) {
    throw new Error(
      "Falta CREDENCIALES_SECRET en el backend. Sin esa variable no se pueden guardar credenciales de correo de forma segura.",
    );
  }
  // El secreto es texto libre; el hash lo lleva al largo exacto que pide AES-256.
  return crypto.createHash("sha256").update(secreto).digest();
}

/** ¿Está el backend en condiciones de guardar credenciales cifradas? */
export function cifradoDisponible(): boolean {
  return Boolean(config.credenciales.secreto);
}

/** Cifra un texto. Devuelve "iv.tag.datos", todo en base64url. */
export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(LARGO_IV);
  const cifrador = crypto.createCipheriv(ALGORITMO, llave(), iv);
  const datos = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), datos.toString("base64url")].join(".");
}

/** Descifra lo que produjo `cifrar`. Lanza si el secreto cambió o la fila fue alterada. */
export function descifrar(valor: string): string {
  const partes = valor.split(".");
  if (partes.length !== 3) throw new Error("Credencial con formato inválido.");

  const [iv, tag, datos] = partes.map((p) => Buffer.from(p, "base64url"));
  const descifrador = crypto.createDecipheriv(ALGORITMO, llave(), iv);
  descifrador.setAuthTag(tag);
  return Buffer.concat([descifrador.update(datos), descifrador.final()]).toString("utf8");
}
