import { useRouterState } from "@tanstack/react-router";
import { Skeleton } from "@/components/ui/skeleton";
import type { TenantInfo } from "@/hooks/useTenantData";
import { configDeCanal } from "@/lib/canales";

export function AppHeader({ tenant, loading }: { tenant: TenantInfo | null; loading: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const canalCfg = configDeCanal(tenant?.canal);
  const titles: Record<string, { title: string; crumb: string }> = {
    "/": { title: "Estadísticas", crumb: "Dashboard" },
    "/conexiones": { title: "Conexiones", crumb: "Integraciones" },
    "/chats": { title: canalCfg.navChats, crumb: "Bandeja" },
    "/archivos": { title: "Archivos", crumb: "Catálogo" },
  };
  const meta = titles[pathname] ?? { title: "Dashboard", crumb: "" };
  const operational = tenant?.systemStatus === "operational";

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-white/5 bg-background/70 px-6 py-5 backdrop-blur-xl md:px-8">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Panel</span>
          <span className="text-muted-foreground/40">/</span>
          <span className="text-foreground/70">{meta.crumb}</span>
        </p>
        {loading ? (
          <Skeleton className="mt-2 h-7 w-56" />
        ) : (
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground md:text-[26px]">
            {meta.title}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 sm:flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span className="text-xs font-medium text-emerald-300">
            {operational ? "Sistema operativo" : "Estado degradado"}
          </span>
        </div>
      </div>
    </header>
  );
}
