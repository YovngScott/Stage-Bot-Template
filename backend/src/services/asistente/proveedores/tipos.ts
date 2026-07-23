/**
 * Contrato agnóstico de proveedor de correo.
 *
 * Todo lo que el asistente necesita de un buzón vive aquí. El pipeline de
 * triaje (heurística → IA → enviar o dejar borrador) trabaja SOLO contra esta
 * interfaz, así que conectar Gmail, Microsoft o un correo corporativo por IMAP
 * no cambia ni una línea de la lógica de negocio.
 *
 * Regla al agregar un proveedor nuevo: nada específico suyo puede asomarse por
 * esta interfaz. Si algo no se puede expresar en estos términos, se resuelve
 * dentro del adaptador.
 */

/** Proveedores soportados. El cliente elige uno al crear el bot. */
export const PROVEEDORES = ["gmail", "microsoft", "imap"] as const;
export type ProveedorCorreo = (typeof PROVEEDORES)[number];

export function esProveedorValido(valor: unknown): valor is ProveedorCorreo {
  return typeof valor === "string" && (PROVEEDORES as readonly string[]).includes(valor);
}

/** Encabezados que necesita el filtro heurístico para descartar sin gastar IA. */
export interface EncabezadosCorreo {
  from: string;
  subject: string;
  listUnsubscribe?: string;
  precedence?: string;
  autoSubmitted?: string;
}

/** Un correo entrante, ya normalizado y sin rastros del proveedor de origen. */
export interface CorreoEntrante {
  /** Identificador del mensaje EN SU PROVEEDOR. Opaco: solo se devuelve tal cual. */
  id: string;
  /** Conversación a la que pertenece, para responder dentro del hilo. */
  hiloId: string;
  encabezados: EncabezadosCorreo;
  /** Texto plano del cuerpo, recortado. Se usa para clasificar y NUNCA se persiste. */
  cuerpo: string;
  recibidoEn: string;
  /** Message-Id RFC 5322 original: encadena la respuesta en el cliente del destinatario. */
  messageId?: string;
}

/** Una respuesta lista para enviarse o guardarse como borrador. */
export interface RespuestaCorreo {
  hiloId: string;
  para: string;
  asunto: string;
  cuerpo: string;
  messageId?: string;
}

/** Identidad del buzón conectado, para confirmar en el dashboard que es el correcto. */
export interface PerfilCorreo {
  email: string;
}

/**
 * Marca semántica del resultado del triaje. Cada adaptador la traduce a lo que
 * su proveedor entienda: etiquetas en Gmail, categorías en Microsoft, keywords
 * IMAP. Es informativa: si el proveedor no puede marcar, el triaje sigue igual.
 */
export type EtiquetaAsistente = "enviado" | "borrador" | "revision";

export const NOMBRE_ETIQUETA: Record<EtiquetaAsistente, string> = {
  enviado: "Respondido solo",
  borrador: "Borrador listo",
  revision: "Requiere revisión",
};

/**
 * Lo que el asistente necesita saber hacer con un buzón, sea cual sea el
 * proveedor detrás.
 */
export interface EmailProvider {
  /** Qué proveedor es. Solo para diagnóstico y para mostrarlo en el dashboard. */
  readonly proveedor: ProveedorCorreo;

  /** Cuenta conectada, o null si las credenciales ya no sirven. */
  perfil(): Promise<PerfilCorreo | null>;

  /** IDs de los correos recibidos después de `desde` (o del último día si es null). */
  listarNuevos(desde: Date | null, maximo: number): Promise<string[]>;

  /** Trae un correo completo. null si ya no existe o no se pudo leer. */
  obtener(id: string): Promise<CorreoEntrante | null>;

  /** Guarda la respuesta como BORRADOR, sin enviarla. Devuelve su id si el proveedor lo da. */
  crearBorrador(respuesta: RespuestaCorreo): Promise<string | null>;

  /** ENVÍA la respuesta. Solo se llama para lo rutinario (ver el gate en triaje.ts). */
  enviar(respuesta: RespuestaCorreo): Promise<string | null>;

  /** Marca el correo con el resultado del triaje. Best-effort: no debe lanzar. */
  etiquetar(correoId: string, etiqueta: EtiquetaAsistente): Promise<void>;

  /** Libera conexiones abiertas (IMAP). Los proveedores REST no hacen nada. */
  cerrar?(): Promise<void>;
}

/**
 * Retroceso exponencial truncado con fluctuación. Lo comparten los adaptadores
 * porque todos los proveedores castigan igual la insistencia ante un 429.
 */
export async function conReintentos<T>(
  operacion: () => Promise<T>,
  etiqueta: string,
  intentos = 5,
): Promise<T> {
  let ultimoError: unknown;
  for (let intento = 0; intento < intentos; intento += 1) {
    try {
      return await operacion();
    } catch (err: any) {
      ultimoError = err;
      const codigo = err?.code ?? err?.status ?? err?.response?.status;
      const recuperable = codigo === 429 || codigo === 403 || (codigo >= 500 && codigo < 600);
      if (!recuperable || intento === intentos - 1) throw err;

      const espera = Math.min(2 ** intento * 1000, 32_000) + Math.random() * 1000;
      console.warn(`[asistente:${etiqueta}] ${codigo} — reintentando en ${Math.round(espera)}ms…`);
      await new Promise((r) => setTimeout(r, espera));
    }
  }
  throw ultimoError;
}

/**
 * Arma el MIME de una respuesta. Gmail e IMAP lo consumen tal cual; Microsoft
 * Graph usa su propio JSON y no lo necesita.
 */
export function construirMime(respuesta: RespuestaCorreo): string {
  const asunto = respuesta.asunto.toLowerCase().startsWith("re:")
    ? respuesta.asunto
    : `Re: ${respuesta.asunto}`;
  // Asunto en base64 (RFC 2047): sin esto los acentos llegan rotos.
  const asuntoCodificado = `=?UTF-8?B?${Buffer.from(asunto, "utf8").toString("base64")}?=`;

  const cabeceras = [
    `To: ${respuesta.para}`,
    `Subject: ${asuntoCodificado}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
  ];
  // Sin estas dos cabeceras el cliente del destinatario muestra la respuesta
  // como un mensaje suelto en vez de dentro de la conversación.
  if (respuesta.messageId) {
    cabeceras.push(`In-Reply-To: ${respuesta.messageId}`, `References: ${respuesta.messageId}`);
  }

  return [...cabeceras, "", respuesta.cuerpo].join("\r\n");
}

/** Normaliza el asunto de una respuesta ("Re: …") para los proveedores que no usan MIME. */
export function asuntoDeRespuesta(asunto: string): string {
  return asunto.toLowerCase().startsWith("re:") ? asunto : `Re: ${asunto}`;
}
