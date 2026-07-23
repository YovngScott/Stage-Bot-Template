import express from "express";
import cors from "cors";
import { config } from "./lib/config.js";
import { cargarTenants, listarTenants } from "./lib/tenants.js";
import { resolverTenant } from "./lib/tenantMiddleware.js";
import { serviciosRouter } from "./routes/servicios.js";
import { whatsappRouter } from "./routes/whatsapp.js";
import { empleadosRouter } from "./routes/empleados.js";
import { calendarRouter } from "./routes/calendar.js";
import { reportesRouter } from "./routes/reportes.js";
import { authRouter } from "./routes/auth.js";
import { configRouter } from "./routes/config.js";
import { asistenteRouter } from "./routes/asistente.js";
import { iniciarTodasLasSesiones } from "./services/baileys.js";
import { iniciarScheduler } from "./services/scheduler.js";

const app = express();

// Fly.io termina el TLS y reenvía por HTTP interno con X-Forwarded-Proto: al
// confiar en el proxy, req.protocol refleja "https" real.
app.set("trust proxy", true);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, servicio: "stage-bot-template", tenants: listarTenants().length }));

// Todas las rutas de negocio van bajo /api/:slug/... — resolverTenant adjunta
// req.tenant o responde 404 si el slug no existe.
app.use("/api/:slug/auth", resolverTenant, authRouter);
app.use("/api/:slug/servicios", resolverTenant, serviciosRouter);
app.use("/api/:slug/whatsapp", resolverTenant, whatsappRouter);
app.use("/api/:slug/empleados", resolverTenant, empleadosRouter);
app.use("/api/:slug/calendar", resolverTenant, calendarRouter);
app.use("/api/:slug/reportes", resolverTenant, reportesRouter);
app.use("/api/:slug/config", resolverTenant, configRouter);
// Módulo de asistente virtual (triaje de correo). Sus rutas rechazan por sí
// mismas a los tenants que no son de tipo "assistant".
app.use("/api/:slug/asistente", resolverTenant, asistenteRouter);
// URL FIJA (sin :slug) para el callback de OAuth de Google — Google siempre
// redirige a la misma "Authorized redirect URI"; el tenant se recupera del
// `state` dentro de routes/calendar.ts, no del path. Montamos el mismo router
// aquí también (sin resolverTenant); solo su ruta /oauth-callback no
// requiere req.tenant, así que es la única que funciona por esta vía.
app.use("/api/calendar", calendarRouter);
// Mismo motivo para Microsoft: su "redirect URI" registrada en Entra ID es
// fija, sin :slug. El tenant se recupera del `state` dentro del router.
app.use("/api/asistente", asistenteRouter);

async function iniciar() {
  const tenants = await cargarTenants();
  if (tenants.size === 0) {
    console.warn(
      "[index] No hay tenants configurados (config/tenants/*.json). El servidor arranca igual, pero sin ninguna sesión de WhatsApp.",
    );
  } else {
    console.log(`[index] Tenants cargados: ${[...tenants.values()].map((t) => t.config.slug).join(", ")}`);
  }

  app.listen(config.port, () => {
    console.log(`🔧 Stage Bot Template — API en http://localhost:${config.port}`);
    console.log(`   Rutas por cliente: /api/<slug>/...  (ej. /api/${[...tenants.keys()][0] ?? "mi-cliente"}/whatsapp/status)`);
  });

  // Si WhatsApp falla al iniciar para un tenant NO tumbamos el servidor HTTP
  // completo: /health y el resto de tenants deben seguir vivos.
  await iniciarTodasLasSesiones([...tenants.values()]);
  iniciarScheduler();
}

iniciar().catch((err) => {
  console.error("[index] Error fatal iniciando el servidor:", err);
  process.exit(1);
});
