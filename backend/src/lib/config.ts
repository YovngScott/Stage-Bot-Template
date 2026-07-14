import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // En desarrollo permitimos arrancar sin todas las credenciales,
    // pero avisamos claramente qué falta.
    console.warn(`[config] ⚠️  Variable de entorno faltante: ${name}`);
    return "";
  }
  return value;
}

/**
 * Configuración GLOBAL de infraestructura (compartida por TODOS los
 * tenants/clientes). Lo específico de cada negocio (nombre, prompt, horario,
 * admins, calendario) vive en config/tenants/<slug>.json — ver lib/tenants.ts.
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),

  // Proveedor de IA para responder mensajes: "groq" (recomendado, capa gratuita
  // generosa con Llama) o "gemini" (Google, capa gratuita muy limitada).
  ai: {
    provider: (process.env.AI_PROVIDER ?? "groq").toLowerCase(),
  },

  groq: {
    apiKey: process.env.GROQ_API_KEY ?? "",
    model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    model: process.env.GEMINI_MODEL ?? "gemini-flash-lite-latest",
  },

  supabase: {
    url: required("SUPABASE_URL"),
    serviceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  },

  google: {
    // Un solo "OAuth client (Web application)" de Google Cloud sirve para
    // TODOS los tenants: cada uno autoriza con SU cuenta desde el dashboard, y
    // su refresh_token queda guardado por separado (tabla google_oauth_tokens,
    // una fila por tenant_id).
    oauthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? "",
    oauthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "",
    oauthRedirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI ?? "",
  },

  // Carpeta base para las sesiones de WhatsApp (Baileys). Cada tenant tiene su
  // propia subcarpeta: `${baileysAuthDirBase}/<slug>/`.
  baileysAuthDirBase: process.env.BAILEYS_AUTH_DIR || "./.baileys_auth",

  // Secreto compartido para que OTRO sistema (el dashboard/owner console de
  // Stage AI Labs, un proyecto de Supabase y despliegue completamente
  // separados) pueda encender/apagar un tenant remotamente sin tener una
  // sesión de Supabase Auth de ESTE proyecto.
  plataforma: {
    secreto: process.env.PLATFORM_ADMIN_SECRET ?? "",
  },

  // Recordatorio de citas (día antes) y reporte diario por WhatsApp a los
  // empleados de CADA tenant. Misma hora global para todos por simplicidad;
  // cada tenant define su propia zona horaria en su config.
  reportes: {
    horaRecordatorioCitas: process.env.RECORDATORIO_CITAS_HORA ?? "09:00",
    horaReporteDiario: process.env.REPORTE_DIARIO_HORA ?? "20:00",
  },
};
