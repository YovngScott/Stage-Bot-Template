/**
 * ============================================================================
 *  MARCA DEL DASHBOARD  —  EDITA PARA CADA CLIENTE NUEVO
 * ============================================================================
 *
 * Nombre y subtítulo que se muestran en la barra lateral, el login y el título
 * de la pestaña del navegador. Se pueden dejar como literales o sobreescribir
 * con variables de entorno VITE_NEGOCIO_* en Netlify/Vercel (recomendado:
 * así el mismo build sirve para cualquier cliente sin tocar código).
 */
export const negocio = {
  nombre: (import.meta.env.VITE_NEGOCIO_NOMBRE as string) || "Mi Negocio",
  subtitulo: (import.meta.env.VITE_NEGOCIO_SUBTITULO as string) || "Consola del bot",
};
