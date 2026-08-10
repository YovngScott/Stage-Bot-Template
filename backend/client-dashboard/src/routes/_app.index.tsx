import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Calendar, CheckCircle2, Download, Package, AlertCircle, Loader2 } from "lucide-react";
import { useTenantData } from "@/hooks/useTenantData";
import { adminFetch, getApiUrl } from "@/lib/api";
import { configDeCanal } from "@/lib/canales";
import { StatCard } from "@/components/dashboard/StatCard";
import { CardShell, ChartSkeleton, KpiSkeleton } from "@/components/dashboard/CardShell";
import { CategoriesChart, FaqList, LineClientsChart } from "@/components/dashboard/ChartSection";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/")({
  head: () => ({
    meta: [
      { title: "Estadísticas · Stage AI Labs" },
      {
        name: "description",
        content:
          "Panel de estadísticas de tu bot de WhatsApp: conversaciones, citas y desempeño en tiempo real.",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { data, loading } = useTenantData();
  const [descargando, setDescargando] = useState(false);
  const canalCfg = configDeCanal(data?.tenant.canal);

  async function descargarReporte() {
    if (!getApiUrl()) {
      alert("Falta configurar VITE_API_URL para generar el reporte.");
      return;
    }
    setDescargando(true);
    try {
      const res = await adminFetch("/reportes/diario.pdf");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("No se pudo generar el reporte en PDF.");
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* KPI + report */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">Resumen de hoy</h2>
          <p className="text-xs text-muted-foreground">{canalCfg.resumenSubtitulo}</p>
        </div>
        <Button
          size="sm"
          onClick={descargarReporte}
          disabled={descargando}
          className="ai-gradient-bg text-white hover:opacity-90 transition-all duration-300 hover:-translate-y-0.5"
        >
          {descargando ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Reporte PDF
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading || !data
          ? Array.from({ length: 4 }).map((_, i) => <KpiSkeleton key={i} />)
          : data.kpis.map((k) => <StatCard key={k.label} kpi={k} />)}
      </div>

      {/* Alerts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CardShell
          title="Próximas citas"
          action={<Calendar className="h-4 w-4 text-muted-foreground" />}
        >
          {loading || !data ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {data.appointments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Calendar className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{a.customer}</p>
                      <p className="truncate text-xs text-muted-foreground">{a.service}</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-foreground/80">
                    {a.time}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardShell>

        <CardShell
          title="Por reponer"
          action={<Package className="h-4 w-4 text-muted-foreground" />}
        >
          {loading || !data ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {data.inventory.map((it) => {
                const isOut = it.status === "out";
                const isLow = it.status === "low";
                return (
                  <li
                    key={it.id}
                    className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={[
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                          isOut
                            ? "bg-rose-500/10 text-rose-300"
                            : isLow
                              ? "bg-amber-500/10 text-amber-300"
                              : "bg-emerald-500/10 text-emerald-300",
                        ].join(" ")}
                      >
                        {isOut || isLow ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{it.item}</p>
                        <p className="text-xs text-muted-foreground">
                          {isOut ? "Agotado" : isLow ? "Stock bajo" : "Stock saludable"}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-xs text-foreground/70">
                      {it.qty} u.
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardShell>
      </div>

      {/* Analytics */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {loading || !data ? (
            <ChartSkeleton />
          ) : (
            <LineClientsChart data={data.chartClientsPerDay} />
          )}
        </div>
        <div>
          {loading || !data ? <ChartSkeleton /> : <CategoriesChart data={data.chartCategories} />}
        </div>
      </div>

      <div>{loading || !data ? <ChartSkeleton /> : <FaqList items={data.faqs} />}</div>
    </div>
  );
}
