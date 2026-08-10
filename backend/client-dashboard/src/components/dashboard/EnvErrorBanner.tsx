import { AlertTriangle, KeyRound } from "lucide-react";
import type { TenantEnvStatus } from "@/hooks/useTenantData";

export function EnvErrorBanner({ env }: { env: TenantEnvStatus }) {
  if (env.missing.length === 0) return null;
  return (
    <div className="mx-6 mt-6 flex items-start gap-4 rounded-2xl border border-amber-400/20 bg-gradient-to-br from-amber-500/[0.08] to-amber-500/[0.02] p-5 backdrop-blur-xl md:mx-8">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold tracking-tight text-amber-100">
          Configuración pendiente · usando datos de demostración
        </p>
        <p className="mt-1 text-xs text-amber-100/70">
          Define las siguientes variables de entorno para conectar este tenant a Lovable Cloud:
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {env.missing.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-1 font-mono text-[11px] text-amber-200"
            >
              <KeyRound className="h-3 w-3" />
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
