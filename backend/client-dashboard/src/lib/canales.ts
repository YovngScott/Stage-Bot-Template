/**
 * Un mismo dashboard sirve a clientes con distintos tipos de bot (mensajería
 * de WhatsApp, llamadas telefónicas, asistente virtual). En vez de tener el
 * copy/labels regados por cada componente, este archivo es la ÚNICA fuente
 * de verdad: agregar o ajustar un canal se hace aquí, y el resto de la app
 * (sidebar, KPIs, tarjeta de conexión) lee de este mapa.
 *
 * El canal de cada tenant vive en `tenants.canal` (Supabase). Si no está
 * configurado, se asume "mensajes" — el producto original.
 */

export type Canal = "mensajes" | "llamadas" | "asistente";

export interface ConfigCanal {
  id: Canal;
  nombre: string;
  nombreCorto: string;
  navChats: string;
  navChatsDescripcion: string;
  conexionTitulo: string;
  conexionDescripcion: string;
  kpiPrincipal: string;
  entidadPlural: string;
  resumenSubtitulo: string;
}

export const CANALES: Record<Canal, ConfigCanal> = {
  mensajes: {
    id: "mensajes",
    nombre: "Bot de Mensajería",
    nombreCorto: "Mensajería",
    navChats: "Estados de chats",
    navChatsDescripcion: "Conversaciones que esperan un humano",
    conexionTitulo: "WhatsApp Business",
    conexionDescripcion: "Vincula el número de WhatsApp que usará el bot para responder.",
    kpiPrincipal: "Escribieron hoy",
    entidadPlural: "clientes",
    resumenSubtitulo: "Métricas clave del bot de WhatsApp actualizadas cada minuto.",
  },
  llamadas: {
    id: "llamadas",
    nombre: "Bot de Llamadas",
    nombreCorto: "Llamadas",
    navChats: "Estados de llamadas",
    navChatsDescripcion: "Llamadas que esperan un humano",
    conexionTitulo: "Línea telefónica",
    conexionDescripcion: "Conecta el número que atenderá el bot de llamadas.",
    kpiPrincipal: "Llamadas hoy",
    entidadPlural: "llamantes",
    resumenSubtitulo: "Métricas clave del bot de llamadas actualizadas cada minuto.",
  },
  asistente: {
    id: "asistente",
    nombre: "Asistente Virtual",
    nombreCorto: "Asistente",
    navChats: "Conversaciones",
    navChatsDescripcion: "Conversaciones que esperan un humano",
    conexionTitulo: "Buzón de correo",
    conexionDescripcion: "Conecta la bandeja que el asistente va a atender.",
    kpiPrincipal: "Correos triados hoy",
    entidadPlural: "remitentes",
    resumenSubtitulo: "Qué resolvió el asistente en tu bandeja y qué espera tu criterio.",
  },
};

export function configDeCanal(canal: string | null | undefined): ConfigCanal {
  return CANALES[canal as Canal] ?? CANALES.mensajes;
}

/**
 * El asistente no vende ni agenda: su panel es el triaje de correo, y las
 * secciones del bot de ventas (citas, catálogo, embudo de chats) no le
 * aplican. La navegación y el resumen se arman según esto.
 */
export function esAsistente(canal: string | null | undefined): boolean {
  return configDeCanal(canal).id === "asistente";
}
