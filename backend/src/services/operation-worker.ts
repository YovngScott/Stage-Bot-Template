import { listarTenants, obtenerTenant } from "../lib/tenants.js";
import { ejecutarTriaje } from "./asistente/triaje.js";
import {
  claimFailures,
  createWorkerId,
  finishRetry,
  markIntervention,
  type OperationFailure,
} from "./operations.js";

const workerId = createWorkerId("automatic");
let timer: NodeJS.Timeout | null = null;
let running = false;

async function executeSafeRetry(failure: OperationFailure): Promise<void> {
  const tenant = obtenerTenant(failure.tenantSlug);
  if (!tenant) throw new Error(`El tenant ${failure.tenantSlug} no está cargado en esta máquina.`);

  if (failure.source === "email" || failure.source === "oauth") {
    const result = await ejecutarTriaje(tenant);
    if (result.error) throw new Error(result.error);
    return;
  }

  // Un timeout al enviar WhatsApp puede significar que el proveedor lo recibió
  // aunque el socket no devolviera confirmación. Reenviar automáticamente puede
  // duplicar un mensaje al cliente; se exige intervención humana hasta usar un
  // proveedor con una confirmación inequívoca.
  await markIntervention(
    failure.tenantSlug,
    failure.id,
    "Reintento automático detenido para evitar un WhatsApp duplicado. Verifica la conversación y reintenta desde Operaciones.",
  );
}

export async function processOperationQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const failures = await claimFailures(workerId, listarTenants().map((tenant) => tenant.config.slug), 10);
    for (const failure of failures) {
      try {
        await executeSafeRetry(failure);
        if (failure.source === "email" || failure.source === "oauth") {
          await finishRetry(failure.id, workerId, true);
        }
      } catch (error) {
        await finishRetry(failure.id, workerId, false, error).catch((finishError) => {
          console.error(`[operations:${failure.tenantSlug}] No se pudo cerrar el reintento:`, finishError);
        });
      }
    }
  } catch (error) {
    console.error("[operations] No se pudo procesar la cola durable:", error);
  } finally {
    running = false;
  }
}

export function startOperationWorker(): void {
  if (timer) return;
  void processOperationQueue();
  timer = setInterval(() => void processOperationQueue(), 30_000);
  timer.unref();
}

export function stopOperationWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
