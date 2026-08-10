import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, Plug, MessageSquare, Phone, Bot, Folder, Zap, LogOut, Mail } from "lucide-react";
import type { TenantInfo } from "@/hooks/useTenantData";
import { configDeCanal, esAsistente } from "@/lib/canales";
import { Skeleton } from "@/components/ui/skeleton";

// El ícono y el label de "chats" cambian según el canal del tenant (bot de
// mensajes, llamadas o asistente) — el resto de la navegación es genérico.
const ICONO_CHATS_POR_CANAL = { mensajes: MessageSquare, llamadas: Phone, asistente: Bot } as const;

export function AppSidebar({
  tenant,
  loading,
  email,
  onSignOut,
}: {
  tenant: TenantInfo | null;
  loading: boolean;
  email?: string | null;
  onSignOut?: () => void;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const displayEmail = email || tenant?.userEmail || "";
  const canalCfg = configDeCanal(tenant?.canal);

  // Un asistente de correo no tiene catálogo ni embudo de chats: su panel es
  // el triaje de la bandeja. Mostrarle "Archivos" o "Estados de chats" sería
  // llevarlo a pantallas vacías.
  const navItems = esAsistente(tenant?.canal)
    ? ([
        { to: "/asistente", label: "Asistente", icon: Mail },
        { to: "/", label: "Estadísticas", icon: BarChart3 },
        { to: "/conexiones", label: "Conexiones", icon: Plug },
      ] as const)
    : ([
        { to: "/", label: "Estadísticas", icon: BarChart3 },
        { to: "/conexiones", label: "Conexiones", icon: Plug },
        { to: "/chats", label: canalCfg.navChats, icon: ICONO_CHATS_POR_CANAL[canalCfg.id] },
        { to: "/archivos", label: "Archivos", icon: Folder },
      ] as const);

  return (
    <aside className="hidden md:flex md:w-72 lg:w-80 shrink-0 flex-col border-r border-white/5 bg-sidebar/80 backdrop-blur-xl">
      {/* Brand */}
      <div className="px-6 pt-7 pb-6">
        <div className="flex items-center gap-2.5">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-xl ai-gradient-bg glow-primary">
            <Zap className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col leading-tight">
            <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Stage AI Labs
            </span>
            <span className="text-xs text-muted-foreground/60">Client Dashboard</span>
          </div>
        </div>

        <div className="mt-6 rounded-xl border border-white/5 bg-white/[0.02] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Negocio
          </p>
          {loading || !tenant ? (
            <Skeleton className="mt-2 h-5 w-40" />
          ) : (
            <p className="mt-1 text-sm font-semibold tracking-tight text-foreground">
              {tenant.businessName}
            </p>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-4">
        {navItems.map((item) => {
          const active = pathname === item.to;
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={[
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                active
                  ? "bg-white/[0.06] text-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05)]"
                  : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
              ].join(" ")}
            >
              <span
                className={[
                  "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                  active
                    ? "bg-primary/15 text-primary"
                    : "bg-white/[0.02] text-muted-foreground group-hover:text-foreground",
                ].join(" ")}
              >
                <Icon className="h-4 w-4" />
              </span>
              {item.label}
              {active && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px] shadow-primary" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/5 p-4">
        {loading && !displayEmail ? (
          <Skeleton className="h-14 w-full" />
        ) : (
          <div className="flex items-center gap-3 rounded-lg bg-white/[0.02] p-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full ai-gradient-bg text-xs font-semibold text-white">
              {(displayEmail[0] ?? "?").toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{displayEmail || "—"}</p>
              <p className="text-[10px] text-muted-foreground">Administrador</p>
            </div>
            <button
              onClick={onSignOut}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-destructive"
              aria-label="Cerrar sesión"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
