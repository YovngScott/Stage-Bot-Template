import path from "node:path";
import fs from "node:fs";
import { Boom } from "@hapi/boom";
import pino from "pino";
import QRCode from "qrcode";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestWaWebVersion,
  DisconnectReason,
  Browsers,
  downloadMediaMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { transcribirAudio, analizarImagen } from "./media.js";
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
import { conTimeout } from "../lib/timeout.js";
import { responderComandoWhatsApp } from "./asistente/triaje.js";
import { queueFailure, recordMetric } from "./operations.js";
import { metaConfigured, sendMetaText, type MetaIncomingMessage } from "./meta-whatsapp.js";
import { canContactNow } from "./tenant-schedule.js";
import {
  checkUsage,
  completeChannelTestResponse,
  consentCommand,
  getRuntimePolicy,
  isConversationHuman,
  isOptedOut,
  isSpamBurst,
  matchInboundChannelTest,
  recordChannelEvent,
  recordUsage,
  saveShadowDecision,
  setConsent,
  shouldAutoSend,
} from "./runtime-controls.js";

const logger = pino({ level: "silent" });

/**
 * UN backend, UNA app de Fly.io, UNA conexión de WhatsApp (Baileys) POR
 * TENANT — cada cliente de Stage AI Labs tiene su propio número vinculado,
 * su propia carpeta de credenciales, y su propia cola de mensajes, pero todo
 * corre en el mismo proceso Node. Onboardear un cliente nuevo = agregar su
 * config/tenants/<slug>.json y reiniciar; no hace falta desplegar nada nuevo.
 */

interface EstadoWhatsApp {
  provider: "baileys" | "meta_cloud";
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
  /** Una cola por chat conserva el orden sin bloquear a los demás clientes. */
  colas: Map<string, Promise<void>>;
  /** Último mensaje observado por chat para agrupar textos enviados en ráfaga. */
  ultimosMensajes: Map<string, string>;
  generacion: number;
  reconexiones: number;
  temporizadorReconexion: NodeJS.Timeout | null;
  iniciando: boolean;
  ultimoLogQr: number;
}

const sesiones = new Map<string, Sesion>(); // key: tenant.id
let siguienteGeneracion = 0;
// Tenants que fueron dados de baja desde Owner Console. El flag evita que el
// listener de Baileys vuelva a reconectar automáticamente después de cerrar la
// sesión y borrar sus credenciales.
const sesionesDesactivadas = new Set<string>();

function authDirDe(tenant: Tenant): string {
  return path.resolve(config.baileysAuthDirBase, tenant.config.slug);
}

function estadoInicial(provider: "baileys" | "meta_cloud" = "baileys"): EstadoWhatsApp {
  return {
    provider,
    conectado: false,
    numero: null,
    qrDataUrl: null,
    pairingCode: null,
    actualizadoEn: Date.now(),
  };
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
  if (sesion?.temporizadorReconexion)
    clearTimeout(sesion.temporizadorReconexion);
  if (sesion?.sock) {
    try {
      // logout invalida la sesión remota en WhatsApp; end corta el socket aun
      // si WhatsApp no responde a tiempo.
      await sesion.sock.logout();
    } catch (err) {
      console.warn(
        `[whatsapp:${tenant.config.slug}] No se pudo cerrar sesión remota:`,
        err,
      );
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

/** Reconexión exponencial con jitter y una sola sesión vigente por tenant. */
function programarReconexion(
  tenant: Tenant,
  generacion: number,
  reiniciarIntentos = false,
): void {
  const sesion = sesiones.get(tenant.id);
  if (
    !sesion ||
    sesion.generacion !== generacion ||
    sesionesDesactivadas.has(tenant.id)
  )
    return;
  if (sesion.temporizadorReconexion) return;
  if (reiniciarIntentos) sesion.reconexiones = 0;

  const intento = sesion.reconexiones++;
  // Si la sesión no está conectada (esperando QR / código), reconectamos en 2s para que el QR refresque de inmediato
  const espera = !sesion.estado.conectado
    ? 2000
    : Math.min(3_000 * 2 ** Math.min(intento, 7), 5 * 60_000) +
      Math.floor(Math.random() * Math.min(3000 * 0.25, 5_000));
  console.warn(
    `[whatsapp:${tenant.config.slug}] Reintentando conexión en ${Math.ceil(espera / 1000)}s (intento ${intento + 1}).`,
  );
  sesion.temporizadorReconexion = setTimeout(() => {
    const actual = sesiones.get(tenant.id);
    if (!actual || actual.generacion !== generacion) return;
    actual.temporizadorReconexion = null;
    iniciarWhatsApp(tenant).catch((error) => {
      console.error(
        `[whatsapp:${tenant.config.slug}] Falló el reinicio de la sesión:`,
        error,
      );
    });
  }, espera);
  sesion.temporizadorReconexion.unref();
}

export async function solicitarCodigoEmparejamiento(
  tenantId: string,
  numero: string,
): Promise<string> {
  let sesion = sesiones.get(tenantId);
  if (sesion?.tenant.config.whatsapp.provider === "meta_cloud") {
    throw new Error("Meta WhatsApp Cloud API no usa QR ni código de emparejamiento.");
  }
  let limpio = numero.replace(/[^\d]/g, "");
  // Si el usuario introduce 10 dígitos de RD (809, 829, 849), anteponemos el 1 automáticamente
  if (limpio.length === 10 && (limpio.startsWith("809") || limpio.startsWith("829") || limpio.startsWith("849"))) {
    limpio = "1" + limpio;
  }
  if (limpio.length < 10) {
    throw new Error(
      "Número inválido. Escribe el número completo con código de país, ej: 18498636074.",
    );
  }

  // Si el socket no está listo, lo despertamos inmediatamente sin esperar el backoff
  if (!sesion?.sock && sesion?.tenant) {
    if (sesion.temporizadorReconexion) {
      clearTimeout(sesion.temporizadorReconexion);
      sesion.temporizadorReconexion = null;
    }
    await iniciarWhatsApp(sesion.tenant).catch(() => {});
    for (let i = 0; i < 20; i++) {
      sesion = sesiones.get(tenantId);
      if (sesion?.sock) break;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  if (!sesion?.sock) {
    throw new Error(
      "El servidor de WhatsApp no pudo conectar. Espera unos segundos e intenta de nuevo.",
    );
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
  const previa = sesiones.get(tenant.id);
  if (previa?.iniciando) return;
  if (previa?.temporizadorReconexion)
    clearTimeout(previa.temporizadorReconexion);

  const generacion = ++siguienteGeneracion;
  const sesion: Sesion = {
    tenant,
    sock: null,
    estado: previa?.estado ?? estadoInicial(tenant.config.whatsapp.provider),
    colas: previa?.colas ?? new Map(),
    ultimosMensajes: previa?.ultimosMensajes ?? new Map(),
    generacion,
    reconexiones: previa?.reconexiones ?? 0,
    temporizadorReconexion: null,
    iniciando: true,
    ultimoLogQr: previa?.ultimoLogQr ?? 0,
  };
  sesiones.set(tenant.id, sesion);

  if (tenant.config.whatsapp.provider === "meta_cloud") {
    sesion.iniciando = false;
    sesion.estado = {
      provider: "meta_cloud",
      conectado: metaConfigured(tenant),
      numero: tenant.config.whatsapp.phoneNumberId || null,
      qrDataUrl: null,
      pairingCode: null,
      actualizadoEn: Date.now(),
    };
    if (!sesion.estado.conectado) {
      console.warn(`[whatsapp:${tenant.config.slug}] Meta Cloud seleccionado, pero faltan secretos o phone number ID.`);
    } else {
      console.log(`✅ [whatsapp:${tenant.config.slug}] Meta WhatsApp Cloud API configurado.`);
    }
    return;
  }

  const authDir = authDirDe(tenant);
  let authState: Awaited<ReturnType<typeof useMultiFileAuthState>>;
  let version: [number, number, number] = [2, 3000, 1045737606];
  try {
    authState = await useMultiFileAuthState(authDir);
    const waVer = await fetchLatestWaWebVersion().catch(() => null);
    if (waVer?.version) {
      version = waVer.version as [number, number, number];
    }
  } catch (error) {
    sesion.iniciando = false;
    programarReconexion(tenant, generacion);
    throw error;
  }

  const sock = makeWASocket({
    version,
    auth: authState.state,
    logger,
    browser: Browsers.ubuntu("Chrome"),
    syncFullHistory: false,
    printQRInTerminal: false,
  });

  const actualAlCrear = sesiones.get(tenant.id);
  if (!actualAlCrear || actualAlCrear.generacion !== generacion) {
    try {
      await sock.end(undefined);
    } catch {
      // Otra generación ya reemplazó este socket.
    }
    return;
  }
  actualAlCrear.sock = sock;
  actualAlCrear.iniciando = false;

  sock.ev.on("creds.update", authState.saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const s = sesiones.get(tenant.id);
    if (!s || s.generacion !== generacion) return;

    if (qr) {
      try {
        s.estado.qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 320,
        });
      } catch (err) {
        console.error(
          `[whatsapp:${tenant.config.slug}] No se pudo generar la imagen del QR:`,
          err,
        );
      }
      s.estado.conectado = false;
      s.estado.actualizadoEn = Date.now();
      if (Date.now() - s.ultimoLogQr >= 2 * 60_000) {
        s.ultimoLogQr = Date.now();
        console.log(
          `[whatsapp:${tenant.config.slug}] Código QR disponible en el dashboard para vincular.`,
        );
      }
    }

    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output
        ?.statusCode;
      s.estado.conectado = false;
      s.estado.numero = null;
      s.estado.actualizadoEn = Date.now();
      s.sock = null;

      if (sesionesDesactivadas.has(tenant.id)) {
        s.estado.qrDataUrl = null;
        s.estado.pairingCode = null;
        return;
      }

      const noAutenticado = !s.estado.conectado && (statusCode === DisconnectReason.loggedOut || statusCode === 401);
      if (noAutenticado) {
        console.warn(
          `[whatsapp:${tenant.config.slug}] Sesión cerrada o no autorizada (código ${statusCode ?? "desconocido"}). Borrando credenciales temporales…`,
        );
        s.estado.qrDataUrl = null;
        s.estado.pairingCode = null;
        try {
          await fs.promises.rm(authDir, { recursive: true, force: true });
        } catch (err) {
          console.error(
            `[whatsapp:${tenant.config.slug}] No se pudo borrar la carpeta de sesión:`,
            err,
          );
        }
        programarReconexion(tenant, generacion, true);
      } else if (statusCode === DisconnectReason.loggedOut) {
        console.warn(
          `[whatsapp:${tenant.config.slug}] Sesión cerrada en el teléfono (401). Borrando credenciales…`,
        );
        s.estado.qrDataUrl = null;
        s.estado.pairingCode = null;
        try {
          await fs.promises.rm(authDir, { recursive: true, force: true });
        } catch (err) {
          console.error(
            `[whatsapp:${tenant.config.slug}] No se pudo borrar la carpeta de sesión:`,
            err,
          );
        }
        programarReconexion(tenant, generacion, true);
      } else {
        console.warn(
          `[whatsapp:${tenant.config.slug}] Conexión cerrada (código ${statusCode ?? "desconocido"}).`,
        );
        programarReconexion(tenant, generacion);
      }
    } else if (connection === "open") {
      s.reconexiones = 0;
      s.estado.conectado = true;
      s.estado.numero = sock.user?.id?.split(":")[0]?.split("@")[0] ?? null;
      s.estado.qrDataUrl = null;
      s.estado.pairingCode = null;
      s.estado.actualizadoEn = Date.now();
      console.log(
        `✅ [whatsapp:${tenant.config.slug}] Conectado — el bot ya puede recibir y responder mensajes.`,
      );
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      const s = sesiones.get(tenant.id);
      if (!s || s.generacion !== generacion) continue;
      const chatId = String(msg.key.remoteJid ?? msg.key.id ?? "desconocido");
      s.ultimosMensajes.set(chatId, String(msg.key.id ?? ""));
      const cola = s.colas.get(chatId) ?? Promise.resolve();
      const siguiente = cola
        .then(() =>
          conTimeout(
            procesarMensajeEntrante(
              tenant,
              msg,
              () => s.ultimosMensajes.get(chatId) === String(msg.key.id ?? ""),
            ),
            90000,
            "procesarMensajeEntrante",
          ),
        )
        .catch((err) =>
          console.error(
            `[whatsapp:${tenant.config.slug}] Error procesando mensaje entrante:`,
            err,
          ),
        )
        .finally(() => {
          if (s.colas.get(chatId) === siguiente) s.colas.delete(chatId);
        });
      s.colas.set(chatId, siguiente);
    }
  });
}

/** Arranca las sesiones de WhatsApp de TODOS los tenants configurados. */
export async function iniciarTodasLasSesiones(
  tenants: Tenant[],
): Promise<void> {
  for (const tenant of tenants) {
    iniciarWhatsApp(tenant).catch((err) => {
      console.error(
        `[whatsapp:${tenant.config.slug}] Error iniciando la conexión (el servidor sigue activo):`,
        err,
      );
    });
  }
}

/** Cierre de proceso: conserva las credenciales y evita reconexiones tardías. */
export async function detenerTodasLasSesiones(): Promise<void> {
  const cierres: Promise<unknown>[] = [];
  for (const [tenantId, sesion] of sesiones) {
    sesionesDesactivadas.add(tenantId);
    if (sesion.temporizadorReconexion)
      clearTimeout(sesion.temporizadorReconexion);
    if (sesion.sock) {
      cierres.push(
        sesion.sock.end(undefined).catch(() => {
          // El transporte puede haberse cerrado antes de recibir SIGTERM.
        }),
      );
    }
  }
  await Promise.allSettled(cierres);
  sesiones.clear();
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

/** Sustantivos que por sí solos ya señalan a una persona. */
const PERSONA =
  /\b(superior|supervis(or|ora)|gerente|encargad[oa]|asesor(a|es)?|emplead[oa]s?|representante|persona|humano|alguien|duen[oa]|agente|operador(a)?|vendedor(a)?|ejecutiv[oa])\b/;

/**
 * Oficios ambiguos: "hablar con un técnico" es escalar, pero "quiero soporte
 * técnico" no. Solo cuentan precedidos de "con un/una/el/la…", que es lo que
 * distingue pedir a una PERSONA de pedir un SERVICIO.
 */
const PERSONA_AMBIGUA =
  /\bcon (un|una|el|la|algun|alguna)\s+(tecnic[oa]|especialista|mecanic[oa]|recepcionista)\b/;

/** Verbos de petición, con sus conjugaciones frecuentes ("pásame", "me pasas"). */
const ACCION =
  /\b(habl(ar|o|e|arme)|comunicar(me)?|transferir(me)?|pas(ar|as|ame|arme|enme)|atender(me)?|atienda|contactar|comunique|quiero|necesito|deseo|quisiera|puedo|podria|hay|contesta|responde)\b/;

/** Expresiones que piden un humano sin nombrar un cargo. */
const FRASES_DIRECTAS =
  /\b(atencion al cliente|servicio al cliente|hablar con alguien|persona real|ser humano|no quiero (un )?bot|con un humano|operador humano)\b/;

/**
 * ¿El cliente está pidiendo hablar con una persona? Al dar true se PAUSA el
 * bot, así que el detector se calibró contra frases reales en ambos sentidos:
 * pedir un humano debe reconocerse aunque se diga de muchas formas, pero
 * preguntar un precio o pedir "soporte técnico" jamás debe silenciar el chat.
 */
function solicitaAtencionHumana(texto: string): boolean {
  const t = normalizarTexto(texto);
  if (FRASES_DIRECTAS.test(t) || PERSONA_AMBIGUA.test(t)) return true;
  return PERSONA.test(t) && ACCION.test(t);
}

async function enviarAJid(
  tenantId: string,
  remoteJid: string,
  texto: string,
): Promise<void> {
  const sesion = sesiones.get(tenantId);
  if (sesion?.tenant.config.whatsapp.provider === "meta_cloud") {
    if (!sesion.estado.conectado) throw new Error("Meta WhatsApp Cloud API no está configurado.");
    const phone = `+${remoteJid.split("@")[0].split(":")[0]}`;
    await sendMetaText(sesion.tenant, phone, texto);
    return;
  }
  if (!sesion?.sock || !sesion.estado.conectado) {
    throw new Error(
      "WhatsApp perdió la conexión antes de enviar la respuesta.",
    );
  }
  await sesion.sock.sendMessage(remoteJid, { text: texto });
}

async function enviarAJidConReintento(
  tenantId: string,
  remoteJid: string,
  texto: string,
): Promise<void> {
  try {
    await enviarAJid(tenantId, remoteJid, texto);
  } catch (primerError) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      // Vuelve a obtener el socket: Baileys pudo reconectar mientras
      // esperábamos y el anterior ya no sería válido.
      await enviarAJid(tenantId, remoteJid, texto);
    } catch (segundoError) {
      throw new AggregateError(
        [primerError, segundoError],
        "WhatsApp no pudo enviar la respuesta tras dos intentos.",
      );
    }
  }
}

/**
 * Responde en el número de alertas de un bot "assistant": nunca IA de ventas,
 * solo un resumen del día bajo demanda (ver responderComandoWhatsApp).
 */
async function manejarMensajeAsistente(
  tenant: Tenant,
  cliente: { id: string },
  remoteJid: string,
  texto: string,
): Promise<void> {
  let respuesta: string;
  try {
    respuesta = await responderComandoWhatsApp(tenant, texto);
  } catch (err) {
    console.error(
      `[whatsapp:${tenant.config.slug}] Error respondiendo comando de asistente:`,
      err,
    );
    respuesta =
      "No pude generar el resumen ahora mismo. Intenta de nuevo en un momento.";
  }

  try {
    await enviarAJidConReintento(tenant.id, remoteJid, respuesta);
  } catch (err) {
    console.error(
      `[whatsapp:${tenant.config.slug}] No se pudo enviar la respuesta del asistente:`,
      err,
    );
    return; // no guardamos como enviado algo que no salió
  }

  await guardarMensaje({
    tenant_id: tenant.id,
    cliente_id: cliente.id,
    rol: "bot",
    contenido: respuesta,
  });
}

async function procesarMensajeEntrante(
  tenant: Tenant,
  msg: any,
  esUltimoMensaje: () => boolean,
): Promise<void> {
  if (!msg.message || msg.key.fromMe) return;

  const remoteJid: string | undefined = msg.key.remoteJid;
  if (
    !remoteJid ||
    remoteJid.endsWith("@g.us") ||
    remoteJid === "status@broadcast"
  )
    return;

  const mediaType = msg.message.imageMessage ? "image"
    : msg.message.audioMessage ? "audio"
      : msg.message.documentMessage ? "document"
        : msg.message.locationMessage ? "location"
          : "text";
  let texto: string | undefined =
    msg.message.conversation ??
    msg.message.extendedTextMessage?.text ??
    undefined;

  if (mediaType === "audio" && msg.message.audioMessage) {
    try {
      const buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;
      const mimeType = msg.message.audioMessage.mimetype || "audio/ogg";
      const transcripcion = await transcribirAudio(buffer, mimeType);
      if (transcripcion) {
        texto = `[Nota de voz recibida por WhatsApp]: "${transcripcion}"`;
      } else {
        texto = "[Audio recibido: no se pudo transcribir el contenido]";
      }
    } catch (err) {
      console.error(`[whatsapp:${tenant.config.slug}] Error descargando audio:`, err);
      texto = "[Audio recibido: error al descargar]";
    }
  } else if (mediaType === "image" && msg.message.imageMessage) {
    try {
      const buffer = (await downloadMediaMessage(msg, "buffer", {})) as Buffer;
      const mimeType = msg.message.imageMessage.mimetype || "image/jpeg";
      const caption = msg.message.imageMessage.caption;
      const descripcionVisual = await analizarImagen(buffer, mimeType, caption);
      if (descripcionVisual) {
        texto = `[Imagen enviada por el cliente por WhatsApp]: ${descripcionVisual}`;
      } else {
        texto = caption || "[Imagen recibida sin descripción]";
      }
    } catch (err) {
      console.error(`[whatsapp:${tenant.config.slug}] Error descargando imagen:`, err);
      texto = msg.message.imageMessage.caption || "[Imagen recibida: error al descargar]";
    }
  } else if (!texto) {
    texto =
      msg.message.imageMessage?.caption ??
      msg.message.documentMessage?.caption ??
      (msg.message.documentMessage ? `[Documento recibido: ${String(msg.message.documentMessage?.fileName ?? "sin nombre")}]` : undefined) ??
      (msg.message.locationMessage ? `[Ubicación recibida: ${Number(msg.message.locationMessage?.degreesLatitude)}, ${Number(msg.message.locationMessage?.degreesLongitude)}]` : undefined) ??
      undefined;
  }

  if (!texto) return;

  const waMessageId: string = msg.key.id;
  if (await mensajeYaProcesado(tenant.id, waMessageId)) return;

  const jidIdentidad: string = remoteJid.endsWith("@lid")
    ? ((msg.key.senderPn as string | undefined) ?? remoteJid)
    : remoteJid;
  const telefono = "+" + jidIdentidad.split("@")[0].split(":")[0];
  const nombre: string | undefined = msg.pushName || undefined;

  await recordChannelEvent({
    tenantId: tenant.id,
    channel: "whatsapp",
    externalId: waMessageId,
    eventType: "inbound",
    mediaType,
    status: "received",
    metadata: { contact: telefono, hasCaption: mediaType !== "text" ? !texto.startsWith("[") : true },
  }).catch(() => undefined);

  const cliente = await obtenerOCrearCliente(tenant.id, telefono, nombre);
  const idGuardado = await guardarMensaje({
    tenant_id: tenant.id,
    cliente_id: cliente.id,
    rol: "cliente",
    contenido: texto,
    wa_message_id: waMessageId,
  });
  if (idGuardado === null) return; // ya procesado por otro worker
  const channelTestId = await matchInboundChannelTest(tenant.id, "whatsapp", texto);

  const consent = consentCommand(texto);
  if (consent) {
    await setConsent(tenant.id, "whatsapp", telefono, consent, `Mensaje ${waMessageId}`);
    const confirmation = consent === "opted_out"
      ? "Listo. No recibirás más mensajes automáticos. Puedes escribir INICIAR cuando quieras reactivarlos."
      : "Listo. Las respuestas automáticas están habilitadas nuevamente.";
    await enviarAJidConReintento(tenant.id, remoteJid, confirmation);
    await guardarMensaje({ tenant_id: tenant.id, cliente_id: cliente.id, rol: "sistema", contenido: confirmation });
    return;
  }
  if (await isOptedOut(tenant.id, "whatsapp", telefono)) return;
  if (await isConversationHuman(tenant.id, "whatsapp", cliente.id)) return;

  const usage = await checkUsage(tenant.id, "whatsapp");
  if (!usage.allowed || await isSpamBurst(tenant.id, "whatsapp", telefono, usage.policy.spamPerMinute)) {
    await queueFailure({
      tenantSlug: tenant.config.slug,
      source: "ai",
      operation: "limite_o_abuso_whatsapp",
      error: new Error(usage.reason || "Ráfaga de mensajes anormal"),
      dedupeKey: `${tenant.config.slug}:policy:${telefono}:${new Date().toISOString().slice(0, 13)}`,
      maxAttempts: 1,
    }).catch(() => undefined);
    return;
  }

  // Una persona suele enviar "Hola" + "quiero una cita" + "mañana" como
  // varios mensajes. Esperamos una ventana corta: los anteriores se guardan,
  // pero solo el último genera respuesta usando todos como contexto.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (!esUltimoMensaje()) return;

  const historialCompleto = await obtenerHistorial(cliente.id, {
    desde: cliente.solicito_humano_en,
    hasta: cliente.atendido_en,
  });
  const historial =
    historialCompleto.at(-1)?.rol === "cliente" &&
    historialCompleto.at(-1)?.contenido === texto
      ? historialCompleto.slice(0, -1)
      : historialCompleto;

  // Interruptor general (Stage AI Labs → Client Manager → apagar/encender
  // este tenant, ej. por falta de pago). Seguimos guardando los mensajes
  // entrantes arriba para no perder historial, pero no respondemos nada.
  if (!(await tenantBotActivo(tenant.id))) return;

  // Un bot "assistant" no vende ni agenda: su WhatsApp es el canal privado de
  // alertas del ejecutivo, no una línea de atención al cliente. Si dejáramos
  // caer esto al loop de ventas de abajo, cualquier mensaje a ese número
  // dispararía el prompt de ventas (con herramientas de catálogo que no
  // existen para este tenant) — cortamos aquí, antes de esa rama.
  if (tenant.config.kind === "assistant") {
    await manejarMensajeAsistente(tenant, cliente, remoteJid, texto);
    return;
  }

  // El cliente pidió EXPLÍCITAMENTE un humano: pausamos el bot para que un
  // asesor tome el chat, pero SOLO por una ventana (3h), nunca para siempre.
  // Si tras esa ventana nadie respondió y el cliente sigue escribiendo, el bot
  // retoma para no dejarlo abandonado. (La IA ya no puede meter al cliente en
  // este estado por su cuenta — ver executor.ts; así el bot no se auto-silencia.)
  if (cliente.estado === "requiere_humano") {
    const desde = cliente.solicito_humano_en
      ? new Date(cliente.solicito_humano_en).getTime()
      : 0;
    const VENTANA_HUMANO_MS = 3 * 60 * 60 * 1000;
    if (desde && Date.now() - desde < VENTANA_HUMANO_MS) return; // dentro de la ventana: lo maneja un humano
    // fuera de la ventana: el bot retoma la conversación.
  }

  const sesion = sesiones.get(tenant.id);
  const sock = sesion?.sock;
  if (sock) {
    await sock.readMessages([msg.key]).catch(() => {});
    await sock.sendPresenceUpdate("composing", remoteJid).catch(() => {});
  }

  if (solicitaAtencionHumana(texto)) {
    await actualizarEstadoCliente(tenant.id, cliente.id, "requiere_humano");
    const respuestaTransferencia = RESPUESTA_TRANSFERENCIA_TPL(
      tenant.config.nombre,
    );
    if (!(await tenantBotActivo(tenant.id))) return;
    await enviarAJidConReintento(tenant.id, remoteJid, respuestaTransferencia);
    await guardarMensaje({
      tenant_id: tenant.id,
      cliente_id: cliente.id,
      rol: "bot",
      contenido: respuestaTransferencia,
    });
    return;
  }

  // Generar la respuesta con un tope de tiempo GENERAL (45s). Aunque cada
  // proveedor de IA ya tiene su propio timeout, este es el cinturón de
  // seguridad final: pase lo que pase (proveedor colgado, bucle de
  // herramientas atascado), el bot SIEMPRE continúa y responde algo. Nunca
  // se queda en "escribiendo…" para siempre.
  let respuesta: Awaited<ReturnType<typeof generarRespuesta>> | null = null;
  const inicioIa = Date.now();
  try {
    respuesta = await conTimeout(
      generarRespuesta(tenant, cliente, historial, texto),
      45000,
      "generarRespuesta",
    );
  } catch (err) {
    console.error(
      `[whatsapp][${tenant.config.slug}] Fallo/timeout generando respuesta para ${telefono}:`,
      err,
    );
    await queueFailure({
      tenantSlug: tenant.config.slug,
      source: "ai",
      operation: "generar_respuesta_whatsapp",
      error: err,
      dedupeKey: `${tenant.config.slug}:ai:${waMessageId}`,
    }).catch(() => undefined);
  }

  const textoFinal = (respuesta?.texto ?? "").trim();
  // Fail closed: si todos los proveedores de IA fallan, el mensaje queda
  // guardado y la operación durable avisa al owner. No se improvisa ni envía.
  if (!textoFinal) return;

  const runtimePolicy = await getRuntimePolicy(tenant.id);
  const contactAllowed = canContactNow(new Date(), tenant.config.zonaHoraria, tenant.config.schedule);
  if (!channelTestId && (!shouldAutoSend(runtimePolicy, waMessageId) || !contactAllowed)) {
    await saveShadowDecision({
      tenantId: tenant.id,
      channel: "whatsapp",
      conversationId: cliente.id,
      incomingId: waMessageId,
      proposedResponse: textoFinal,
      decision: !contactAllowed ? "outside_contact_hours" : runtimePolicy.mode === "paused" ? "paused" : "shadow",
      model: config.groq.model,
    });
    await recordUsage(tenant.id, "whatsapp", {
      messages: 1,
      inputTokens: respuesta?.tokensEntrada,
      outputTokens: respuesta?.tokensSalida,
    }).catch(() => undefined);
    return;
  }

  // Retraso "humano" fijo de 5 segundos antes de responder (mostrando el
  // indicador "escribiendo…"): responder al instante hace que WhatsApp marque
  // la cuenta como bot. 5s es suficiente para verse natural sin hacer esperar.
  const esperaMs = 5000;
  if (sock)
    await sock.sendPresenceUpdate("composing", remoteJid).catch(() => {});
  await new Promise((r) => setTimeout(r, esperaMs));

  // Revisa de nuevo justo antes de enviar. Si el owner apaga el bot mientras
  // Gemini/Groq estaba pensando o durante el delay humano, no debe salir una
  // respuesta "atrasada" después de apagado.
  if (!(await tenantBotActivo(tenant.id))) return;

  // El envío también va protegido: si sendMessage falla, lo registramos pero
  // no dejamos que tumbe el procesamiento (ni que quede sin log). Reintento
  // único por si fue un fallo de red puntual.
  try {
    await enviarAJid(tenant.id, remoteJid, textoFinal);
  } catch (err) {
    console.error(
      `[whatsapp][${tenant.config.slug}] Error enviando respuesta a ${telefono}, reintentando:`,
      err,
    );
    try {
      await new Promise((r) => setTimeout(r, 1500));
      await enviarAJid(tenant.id, remoteJid, textoFinal);
    } catch (err2) {
      console.error(
        `[whatsapp][${tenant.config.slug}] Segundo fallo enviando a ${telefono}:`,
        err2,
      );
      await queueFailure({
        tenantSlug: tenant.config.slug,
        source: "whatsapp",
        operation: "enviar_respuesta",
        error: err2,
        dedupeKey: `${tenant.config.slug}:send:${waMessageId}`,
      }).catch(() => undefined);
      return; // no guardamos como enviado algo que no salió
    }
  }

  await guardarMensaje({
    tenant_id: tenant.id,
    cliente_id: cliente.id,
    rol: "bot",
    contenido: textoFinal,
    tokens_entrada: respuesta?.tokensEntrada,
    tokens_salida: respuesta?.tokensSalida,
  });
  if (channelTestId) {
    await completeChannelTestResponse(channelTestId, tenant.id, true).catch(() => undefined);
  }
  await recordMetric({
    tenantSlug: tenant.config.slug,
    source: "whatsapp",
    latencyMs: Date.now() - inicioIa,
    tokens:
      Number(respuesta?.tokensEntrada ?? 0) +
      Number(respuesta?.tokensSalida ?? 0),
  }).catch(() => undefined);
  await recordUsage(tenant.id, "whatsapp", {
    messages: 1,
    inputTokens: respuesta?.tokensEntrada,
    outputTokens: respuesta?.tokensSalida,
  }).catch(() => undefined);
}

/** Envía un mensaje de texto a un número (formato E.164) desde el WhatsApp de un tenant. */
/** Entrada normalizada desde el webhook oficial de Meta Cloud API. */
export async function procesarMensajeMeta(tenant: Tenant, incoming: MetaIncomingMessage): Promise<void> {
  if (tenant.config.whatsapp.provider !== "meta_cloud") return;
  const sesion = sesiones.get(tenant.id);
  if (!sesion) throw new Error("La sesión Meta del tenant no está inicializada.");
  const chatId = incoming.phone.replace(/\D/g, "") + "@s.whatsapp.net";
  sesion.ultimosMensajes.set(chatId, incoming.id);
  const fakeMessage = {
    key: { remoteJid: chatId, id: incoming.id, fromMe: false },
    pushName: incoming.name,
    message: incoming.mediaType === "image"
      ? { imageMessage: { caption: incoming.text, mediaId: incoming.mediaId } }
      : incoming.mediaType === "audio"
        ? { audioMessage: { mediaId: incoming.mediaId } }
        : incoming.mediaType === "document"
          ? { documentMessage: { caption: incoming.text, mediaId: incoming.mediaId } }
          : incoming.mediaType === "location"
            ? { locationMessage: {}, conversation: incoming.text }
            : { conversation: incoming.text },
  };
  const previous = sesion.colas.get(chatId) ?? Promise.resolve();
  const next = previous.then(() =>
    conTimeout(
      procesarMensajeEntrante(tenant, fakeMessage, () => sesion.ultimosMensajes.get(chatId) === incoming.id),
      90_000,
      "procesarMensajeMeta",
    ),
  );
  sesion.colas.set(chatId, next);
  try {
    await next;
  } finally {
    if (sesion.colas.get(chatId) === next) sesion.colas.delete(chatId);
  }
}

export async function enviarMensajeTexto(
  tenantId: string,
  telefono: string,
  texto: string,
): Promise<void> {
  // El apagado debe ser absoluto: también bloquea recordatorios, confirmaciones
  // y cualquier envío iniciado fuera del manejador de mensajes entrantes.
  if (!(await tenantBotActivo(tenantId))) return;
  const sesion = sesiones.get(tenantId);
  if (!sesion)
    throw new Error("WhatsApp no está conectado todavía para este cliente.");
  // El socket existe desde que arranca el intento de conexión, pero mientras
  // nadie escanee el QR no hay sesión: enviar ahí revienta dentro de Baileys
  // con un TypeError ilegible. Mejor decir qué falta de verdad.
  if (!sesion.estado.conectado) {
    throw new Error(
      "El WhatsApp de este cliente no está vinculado: escanea el QR desde el dashboard para recibir alertas.",
    );
  }
  const jid = telefono.replace(/[^\d]/g, "") + "@s.whatsapp.net";
  await enviarAJidConReintento(tenantId, jid, texto);
}
