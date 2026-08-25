import express from "express";
import cors from "cors";
import { spawn, type ChildProcess } from "node:child_process";
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
import { operationsRouter } from "./routes/operations.js";
import { voiceRouter } from "./routes/voice.js";
import { insuranceRouter } from "./routes/insurance.js";
import { detenerTodasLasSesiones, iniciarTodasLasSesiones, obtenerEstadoWhatsApp } from "./services/baileys.js";
import { detenerScheduler, iniciarScheduler } from "./services/scheduler.js";
import { startOperationWorker, stopOperationWorker } from "./services/operation-worker.js";
import { aprovisionarAsistenteVapi } from "./services/vapi-provisioning.js";

const app = express();
let dashboardProcess: ChildProcess | null = null;
let httpServer: ReturnType<typeof app.listen> | null = null;
let apagando = false;

// Fly.io termina el TLS y reenvía por HTTP interno con X-Forwarded-Proto
app.set("trust proxy", true);

app.use(cors());
app.use(
  express.json({
    limit: "20mb",
    verify: (req, _res, buffer) => {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }),
);

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

// Todas las rutas de negocio van bajo /api/:slug/...
app.use("/api/:slug/auth", resolverTenant, authRouter);
app.use("/api/:slug/servicios", resolverTenant, serviciosRouter);
app.use("/api/:slug/whatsapp", resolverTenant, whatsappRouter);
app.use("/api/:slug/empleados", resolverTenant, empleadosRouter);
app.use("/api/:slug/calendar", resolverTenant, calendarRouter);
app.use("/api/:slug/reportes", resolverTenant, reportesRouter);
app.use("/api/:slug/config", resolverTenant, configRouter);
app.use("/api/:slug/asistente", resolverTenant, asistenteRouter);
app.use("/api/:slug/operations", resolverTenant, operationsRouter);
app.use("/api/:slug/voice", resolverTenant, voiceRouter);
app.use("/api/:slug/insurance", resolverTenant, insuranceRouter);

app.use("/api/calendar", calendarRouter);
app.use("/api/asistente", asistenteRouter);
app.use("/api/insurance", insuranceRouter);

// Cada app dedicada de Fly sirve su dashboard y su API desde el mismo hostname
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
  stopOperationWorker();
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
    console.log(`[index] Tenants cargados: ${Array.from(tenants.values()).map((t) => t.config.slug).join(", ")}`);
  }

  iniciarScheduler();
  startOperationWorker();
  await iniciarTodasLasSesiones();

  for (const tenant of tenants.values()) {
    aprovisionarAsistenteVapi(tenant).catch((err) => {
      console.error(
        `[vapi] Error aprovisionando voz para ${tenant.config.slug}:`,
        err,
      );
    });
  }

  const port = process.env.PORT || 8080;
  httpServer = app.listen(port, () => {
    console.log(`[index] Servidor escuchando en puerto ${port}`);
  });
}

void iniciar();
