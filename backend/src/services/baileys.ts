import path from "node:path";
import fs from "node:fs";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { config } from "../lib/config.js";
import type { Tenant } from "../lib/tenants.js";
import { tenantBotActivo } from "../lib/tenants.js";
import {
  actualizarEstadoCliente,
  obtenerOCrearCliente,
  guardarMensaje,
  mensajeYaProcesado,
  obtenerHistorial,
} from "./clientes.js";
import { generarRespuesta } from "./ia.js";

const logger = pino({ level: "silent" });

/**
 * UN backend, UNA app de Fly.io, UNA conexión de WhatsApp (Baileys) POR
 * TENANT — cada cliente de Stage AI Labs tiene su propio número vinculado,
 * su propia carpeta de credenciales, y su propia cola de mensajes, pero todo
 * corre en el mismo proceso Node. Onboardear un cliente nuevo = agregar su
 * config/tenants/<slug>.json y reiniciar; no hace falta desplegar nada nuevo.
 */

interface EstadoWhatsApp {
  conectado: boolean;
  numero: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  actualizadoEn: number;
}

interface Sesion {
  tenant: Tenant;
  sock: WASocket | null;
  estado: EstadoWhatsApp;
  cola: Promise<void>;
}

const sesiones = new Map<string, Sesion>(); // key: tenant.id
// Tenants que fueron dados de baja desde Owner Console. El flag evita que el
// listener de Baileys vuelva a reconectar automáticamente después de cerrar la
// sesión y borrar sus credenciales.
const sesionesDesactivadas = new Set<string>();

function authDirDe(tenant: Tenant): string {
  return path.resolve(config.baileysAuthDirBase, tenant.config.slug);
}

function estadoInicial(): EstadoWhatsApp {
  return { conectado: false, numero: null, qrDataUrl: null, pairingCode: null, actualizadoEn: Date.now() };
}

export function obtenerEstadoWhatsApp(tenantId: string): EstadoWhatsApp | null {
  return sesiones.get(tenantId)?.estado ?? null;
}

/**
 * Cierra la conexión de WhatsApp de un tenant y elimina sus credenciales
 * locales. Se usa para una baja: el bot deja de responder y el número debe
 * volver a escanear un QR para ser conectado otra vez.
 */
export async function desconectarWhatsApp(tenant: Tenant): Promise<void> {
  sesionesDesactivadas.add(tenant.id);
  const sesion = sesiones.get(tenant.id);
  if (sesion?.sock) {
    try {
      // logout invalida la sesión remota en WhatsApp; end corta el socket aun
      // si WhatsApp no responde a tiempo.
      await sesion.sock.logout();
    } catch (err) {
      console.warn(`[whatsapp:${tenant.config.slug}] No se pudo cerrar sesión remota:`, err);
    }
    try {
      await sesion.sock.end(undefined);
    } catch {
      // El socket ya puede haberse cerrado por logout.
    }
  }
  sesiones.delete(tenant.id);
  await fs.promises.rm(authDirDe(tenant), { recursive: true, force: true });
}

export async function solicitarCodigoEmparejamiento(tenantId: string, numero: string): Promise<string> {
  const sesion = sesiones.get(tenantId);
  if (!sesion?.sock) {
    throw new Error("El servidor de WhatsApp de este cliente todavía no está listo. Espera unos segundos e intenta de nuevo.");
  }
  const limpio = numero.replace(/[^\d]/g, "");
  if (limpio.length < 10) {
    throw new Error("Número inválido. Escribe el número completo con código de país, ej: 18498636074.");
  }
  const codigo = await sesion.sock.requestPairingCode(limpio);
  sesion.estado.pairingCode = codigo;
  sesion.estado.actualizadoEn = Date.now();
  return codigo;
}

/** Inicia (o reinicia) la conexión de WhatsApp de UN tenant. */
export async function iniciarWhatsApp(tenant: Tenant): Promise<void> {
  // Al encender el bot se permite otra vez iniciar una sesión limpia y mostrar
  // el QR. Desactivar no intenta reconectarlo por sí solo.
  sesionesDesactivadas.delete(tenant.id);
  const authDir = authDirDe(tenant);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: [tenant.config.nombreBot, "Chrome", "1.0.0"],
  });

  const estado = sesiones.get(tenant.id)?.estado ?? estadoInicial();
  sesiones.set(tenant.id, { tenant, sock, estado, cola: Promise.resolve() });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const s = sesiones.get(tenant.id);
    if (!s) return;

    if (qr) {
      try {
        s.estado.qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      } catch (err) {
        console.error(`[whatsapp:${tenant.config.slug}] No se pudo generar la imagen del QR:`, err);
      }
      s.estado.conectado = false;
      s.estado.actualizadoEn = Date.now();
      console.log(`[whatsapp:${tenant.config.slug}] Nuevo código QR generado — ábrelo desde el dashboard para vincular.`);
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      s.estado.conectado = false;
      s.estado.numero = null;
      s.estado.actualizadoEn = Date.now();

      if (sesionesDesactivadas.has(tenant.id)) {
        s.estado.qrDataUrl = null;
        s.estado.pairingCode = null;
        return;
      }

      if (statusCode === DisconnectReason.loggedOut) {
        console.warn(`[whatsapp:${tenant.config.slug}] Sesión inválida (401). Borrando credenciales y reiniciando limpio…`);
        s.estado.qrDataUrl = null;
        s.estado.pairingCode = null;
        try {
          await fs.promises.rm(authDir, { recursive: true, force: true });
        } catch (err) {
          console.error(`[whatsapp:${tenant.config.slug}] No se pudo borrar la carpeta de sesión:`, err);
        }
        setTimeout(() => iniciarWhatsApp(tenant).catch(console.error), 2000);
      } else {
        console.warn(`[whatsapp:${tenant.config.slug}] Conexión cerrada (código ${statusCode}). Reconectando…`);
        setTimeout(() => iniciarWhatsApp(tenant).catch(console.error), 3000);
      }
    } else if (connection === "open") {
      s.estado.conectado = true;
      s.estado.numero = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
      s.estado.qrDataUrl = null;
      s.estado.pairingCode = null;
      s.estado.actualizadoEn = Date.now();
      console.log(`✅ [whatsapp:${tenant.config.slug}] Conectado — el bot ya puede recibir y responder mensajes.`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const s = sesiones.get(tenant.id);
      if (!s) continue;
      s.cola = s.cola
        .then(() => procesarMensajeEntrante(tenant, msg))
        .catch((err) => console.error(`[whatsapp:${tenant.config.slug}] Error procesando mensaje entrante:`, err));
    }
  });
}

/** Arranca las sesiones de WhatsApp de TODOS los tenants configurados. */
export async function iniciarTodasLasSesiones(tenants: Tenant[]): Promise<void> {
  for (const tenant of tenants) {
    iniciarWhatsApp(tenant).catch((err) => {
      console.error(`[whatsapp:${tenant.config.slug}] Error iniciando la conexión (el servidor sigue activo):`, err);
    });
  }
}

const RESPUESTA_TRANSFERENCIA_TPL = (nombreNegocio: string) =>
  `Claro, ya transferimos tu solicitud con un supervisor de ${nombreNegocio}. Un asesor te responderá personalmente por este mismo chat en breve. 🙏`;

function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function solicitaAtencionHumana(texto: string): boolean {
  const t = normalizarTexto(texto);
  return /\b(superior|supervis(or|ora)|gerente|encargad[oa]|asesor|emplead[oa]|representante|persona|humano)\b/.test(t) &&
    /\b(hablar|comunicar|transferir|pasar|atender|contactar|quiero|necesito|deseo)\b/.test(t);
}

async function procesarMensajeEntrante(tenant: Tenant, msg: any): Promise<void> {
  if (!msg.message || msg.key.fromMe) return;

  const remoteJid: string | undefined = msg.key.remoteJid;
  if (!remoteJid || remoteJid.endsWith("@g.us") || remoteJid === "status@broadcast") return;

  const texto: string | undefined =
    msg.message.conversation ??
    msg.message.extendedTextMessage?.text ??
    msg.message.imageMessage?.caption ??
    undefined;

  if (!texto) return;

  const waMessageId: string = msg.key.id;
  if (await mensajeYaProcesado(tenant.id, waMessageId)) return;

  const jidIdentidad: string = remoteJid.endsWith("@lid")
    ? (msg.key.senderPn as string | undefined) ?? remoteJid
    : remoteJid;
  const telefono = "+" + jidIdentidad.split("@")[0].split(":")[0];
  const nombre: string | undefined = msg.pushName || undefined;

  const cliente = await obtenerOCrearCliente(tenant.id, telefono, nombre);
  const historial = await obtenerHistorial(cliente.id, {
    desde: cliente.solicito_humano_en,
    hasta: cliente.atendido_en,
  });

  const idGuardado = await guardarMensaje({
    tenant_id: tenant.id,
    cliente_id: cliente.id,
    rol: "cliente",
    contenido: texto,
    wa_message_id: waMessageId,
  });
  if (idGuardado === null) return; // ya procesado por otro worker

  // Interruptor general (Stage AI Labs → Client Manager → apagar/encender
  // este tenant, ej. por falta de pago). Seguimos guardando los mensajes
  // entrantes arriba para no perder historial, pero no respondemos nada.
  if (!(await tenantBotActivo(tenant.id))) return;

  if (cliente.estado === "requiere_humano") return;

  const sesion = sesiones.get(tenant.id);
  const sock = sesion?.sock;
  if (sock) {
    await sock.readMessages([msg.key]).catch(() => {});
    await sock.sendPresenceUpdate("composing", remoteJid).catch(() => {});
  }

  if (solicitaAtencionHumana(texto)) {
    await actualizarEstadoCliente(tenant.id, cliente.id, "requiere_humano");
    const respuestaTransferencia = RESPUESTA_TRANSFERENCIA_TPL(tenant.config.nombre);
    if (!(await tenantBotActivo(tenant.id))) return;
    await sock?.sendMessage(remoteJid, { text: respuestaTransferencia });
    await guardarMensaje({
      tenant_id: tenant.id,
      cliente_id: cliente.id,
      rol: "bot",
      contenido: respuestaTransferencia,
    });
    return;
  }

  const respuesta = await generarRespuesta(tenant, cliente, historial, texto);

  // Retraso "humano" fijo de 5 segundos antes de responder (mostrando el
  // indicador "escribiendo…"): responder al instante hace que WhatsApp marque
  // la cuenta como bot. 5s es suficiente para verse natural sin hacer esperar.
  const esperaMs = 5000;
  if (sock) await sock.sendPresenceUpdate("composing", remoteJid).catch(() => {});
  await new Promise((r) => setTimeout(r, esperaMs));

  // Revisa de nuevo justo antes de enviar. Si el owner apaga el bot mientras
  // Gemini/Groq estaba pensando o durante el delay humano, no debe salir una
  // respuesta "atrasada" después de apagado.
  if (!(await tenantBotActivo(tenant.id))) return;

  await sock?.sendMessage(remoteJid, { text: respuesta.texto });

  await guardarMensaje({
    tenant_id: tenant.id,
    cliente_id: cliente.id,
    rol: "bot",
    contenido: respuesta.texto,
    tokens_entrada: respuesta.tokensEntrada,
    tokens_salida: respuesta.tokensSalida,
  });
}

/** Envía un mensaje de texto a un número (formato E.164) desde el WhatsApp de un tenant. */
export async function enviarMensajeTexto(tenantId: string, telefono: string, texto: string): Promise<void> {
  // El apagado debe ser absoluto: también bloquea recordatorios, confirmaciones
  // y cualquier envío iniciado fuera del manejador de mensajes entrantes.
  if (!(await tenantBotActivo(tenantId))) return;
  const sesion = sesiones.get(tenantId);
  if (!sesion?.sock) throw new Error("WhatsApp no está conectado todavía para este cliente.");
  const jid = telefono.replace(/[^\d]/g, "") + "@s.whatsapp.net";
  await sesion.sock.sendMessage(jid, { text: texto });
}
