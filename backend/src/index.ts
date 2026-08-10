import express from "express";
import cors from "cors";
import { spawn, type ChildProcess } from "node:child_process";
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
import { detenerTodasLasSesiones, iniciarTodasLasSesiones, obtenerEstadoWhatsApp } from "./services/baileys.js";
import { detenerScheduler, iniciarScheduler } from "./services/scheduler.js";

const app = express();
let dashboardProcess: ChildProcess | null = null;
let httpServer: ReturnType<typeof app.listen> | null = null;
let apagando = false;

// Fly.io termina el TLS y reenvía por HTTP interno con X-Forwarded-Proto: al
// confiar en el proxy, req.protocol refleja "https" real.
app.set("trust proxy", true);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  const estados = listarTenants().map((tenant) => obtenerEstadoWhatsApp(tenant.id));
  res.json({
    ok: true,
    servicio: "stage-bot-template",
    uptimeSeconds: Math.floor(process.uptime()),
    tenants: estados.length,
    whatsapp: {
      conectados: estados.filter((estado) => estado?.conectado).length,
      esperandoVinculacion: estados.filter((estado) => estado && !estado.conectado && estado.qrDataUrl).length,
    },
  });
});

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

// Cada app dedicada de Fly sirve su dashboard y su API desde el mismo
// hostname. Nitro escucha solamente dentro de la Machine; Express conserva el
// puerto público y reenvía aquí toda ruta que no sea API.
app.use(async (req, res, next) => {
  const dashboardOrigin = process.env.DASHBOARD_ORIGIN?.trim();
  if (!dashboardOrigin || req.path.startsWith("/api/")) return next();
  if (req.method !== "GET" && req.method !== "HEAD") return res.sendStatus(405);

  try {
    const target = new URL(req.originalUrl, dashboardOrigin);
    const upstream = await fetch(target, { method: req.method });
    res.status(upstream.status);
    upstream.headers.forEach((value, name) => {
      if (!["connection", "keep-alive", "transfer-encoding"].includes(name.toLowerCase())) {
        res.setHeader(name, value);
      }
    });
    if (req.method === "HEAD") return res.end();
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    return next(error);
  }
});

function iniciarDashboardIntegrado() {
  const entry = process.env.DASHBOARD_ENTRY?.trim();
  const port = process.env.DASHBOARD_PORT?.trim() || "3001";
  if (!entry) return;

  dashboardProcess = spawn(process.execPath, [entry], {
    env: { ...process.env, HOST: "127.0.0.1", PORT: port },
    stdio: "inherit",
  });
  dashboardProcess.on("error", (error) => {
    console.error("[dashboard] No se pudo iniciar el dashboard integrado:", error);
    process.exit(1);
  });
  dashboardProcess.on("exit", (code, signal) => {
    console.error(`[dashboard] El proceso terminó (código ${code ?? "?"}, señal ${signal ?? "?"}).`);
    if (!apagando) process.exit(code ?? 1);
  });
}

async function apagar(signal: string): Promise<void> {
  if (apagando) return;
  apagando = true;
  console.log(`[index] ${signal}: cerrando conexiones de forma segura…`);
  detenerScheduler();
  const limite = setTimeout(() => process.exit(1), 10_000);
  limite.unref();

  await Promise.allSettled([
    detenerTodasLasSesiones(),
    new Promise<void>((resolve) => {
      if (!httpServer) return resolve();
      httpServer.close(() => resolve());
    }),
  ]);
  if (dashboardProcess && !dashboardProcess.killed) dashboardProcess.kill("SIGTERM");
  clearTimeout(limite);
  process.exit(0);
}

process.once("SIGTERM", () => void apagar("SIGTERM"));
process.once("SIGINT", () => void apagar("SIGINT"));

async function iniciar() {
  iniciarDashboardIntegrado();
  const tenants = await cargarTenants();
  if (tenants.size === 0) {
    console.warn(
      "[index] No hay tenants configurados (config/tenants/*.json). El servidor arranca igual, pero sin ninguna sesión de WhatsApp.",
    );
  } else {
    console.log(`[index] Tenants cargados: ${[...tenants.values()].map((t) => t.config.slug).join(", ")}`);
  }

  httpServer = app.listen(config.port, () => {
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
