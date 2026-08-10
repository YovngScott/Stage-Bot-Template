import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tenantsDir = path.join(backendDir, "config", "tenants");
const dashboardPublicEnvPath = path.join(backendDir, "client-dashboard", "config.public.env");
const dryRun = process.argv.includes("--dry-run");
const flyctl = process.platform === "win32" ? "flyctl.exe" : "flyctl";

function readEnvFile(filePath) {
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
  );
}

function validateDashboardPublicEnv() {
  const publicEnv = readEnvFile(dashboardPublicEnvPath);
  const supabaseUrl = publicEnv.VITE_SUPABASE_URL ?? "";
  const publicKey =
    publicEnv.VITE_SUPABASE_PUBLISHABLE_KEY ?? publicEnv.VITE_SUPABASE_ANON_KEY ?? "";
  const projectRef = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(supabaseUrl)?.[1];

  if (!projectRef) throw new Error("VITE_SUPABASE_URL no es una URL válida de Supabase.");
  if (!publicKey) throw new Error("Falta la clave pública de Supabase del dashboard.");

  // Las nuevas claves `sb_publishable_...` no son JWT. Para las claves anon
  // heredadas validamos también sus claims para impedir publicar un token
  // editado/corrupto que terminaría mostrando `Invalid API key` al cliente.
  if (publicKey.startsWith("eyJ")) {
    try {
      const parts = publicKey.split(".");
      if (parts.length !== 3) throw new Error("JWT incompleto");
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (claims.iss !== "supabase" || claims.ref !== projectRef || claims.role !== "anon") {
        throw new Error("claims inesperados");
      }
    } catch (error) {
      throw new Error(
        `La clave pública de Supabase del dashboard es inválida: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (!publicKey.startsWith("sb_publishable_")) {
    throw new Error("Formato de clave pública de Supabase no reconocido.");
  }
}

function run(args, options = {}) {
  if (dryRun) return "";
  return execFileSync(flyctl, args, {
    cwd: backendDir,
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
}

function appExists(appName) {
  if (dryRun) return true;
  try {
    run(["status", "--app", appName], { capture: true });
    return true;
  } catch {
    return false;
  }
}

function makeAppName(slug, kind) {
  return `stage-${slug}-${kind}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function dedicatedConfig(appName, slug) {
  return `app = '${appName}'
primary_region = 'ewr'

[build]
  dockerfile = 'Dockerfile'

[env]
  BAILEYS_AUTH_DIR = '/data/.baileys_auth'
  PORT = '8080'
  AI_PROVIDER = 'groq'
  GROQ_MODEL = 'llama-3.3-70b-versatile'
  TENANT_SLUGS = '${slug}'

[[mounts]]
  source = 'bot_data'
  destination = '/data'

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = 'off'
  auto_start_machines = true
  min_machines_running = 0

  [[http_service.checks]]
    interval = '30s'
    timeout = '5s'
    grace_period = '90s'
    method = 'GET'
    path = '/health'

[[vm]]
  size = 'shared-cpu-1x'
  memory = '512mb'
  cpus = 1
  memory_mb = 512
`;
}

async function waitForHealth(appName) {
  if (dryRun) return;
  let lastError = "";
  for (let attempt = 0; attempt < 18; attempt += 1) {
    try {
      const response = await fetch(`https://${appName}.fly.dev/health`);
      const body = await response.json().catch(() => null);
      if (response.ok && body?.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${appName} no superó el health check: ${lastError}`);
}

const tenantFiles = readdirSync(tenantsDir)
  .filter((file) => file.endsWith(".json"))
  .sort();
const dedicatedApps = [];

validateDashboardPublicEnv();

for (const file of tenantFiles) {
  const filePath = path.join(tenantsDir, file);
  const tenant = JSON.parse(readFileSync(filePath, "utf8"));
  const slug = String(tenant.slug ?? "").trim();
  const kind = String(tenant.kind ?? "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
    throw new Error(`Slug inválido en ${file}: ${slug || "(vacío)"}`);
  }
  if (kind && !["assistant", "messaging", "voice"].includes(kind)) {
    throw new Error(`Tipo de bot inválido en ${file}: ${kind}`);
  }
  if (kind) dedicatedApps.push({ slug, appName: makeAppName(slug, kind) });
}

console.log(`Tenants válidos: ${tenantFiles.length}. Apps dedicadas declaradas: ${dedicatedApps.length}.`);
if (dryRun) {
  for (const app of dedicatedApps) console.log(`[dry-run] ${app.appName} <- ${app.slug}`);
  process.exit(0);
}

if (!process.env.FLY_API_TOKEN) throw new Error("Falta FLY_API_TOKEN.");

// The historic shared app hosts Wiltech and Domínguez and must stay in sync
// with backend changes. New clients use one dedicated app each.
run(["deploy", "--config", "fly.toml", "--remote-only", "--yes", "--app", "wiltech-bot"]);
await waitForHealth("wiltech-bot");

for (const { appName, slug } of dedicatedApps) {
  if (!appExists(appName)) {
    console.log(`Skipping ${appName}: the Owner Console has not provisioned it yet.`);
    continue;
  }
  const configPath = path.join(backendDir, `.fleet-${slug}.toml`);
  try {
    writeFileSync(configPath, dedicatedConfig(appName, slug), "utf8");
    run(["deploy", "--config", configPath, "--remote-only", "--yes", "--app", appName]);
  } finally {
    if (existsSync(configPath)) rmSync(configPath, { force: true });
  }
  await waitForHealth(appName);
}

console.log("Bot fleet deployment completed successfully.");
