import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import type { Kpi } from "@/hooks/useTenantData";

export function StatCard({ kpi }: { kpi: Kpi }) {
  const positive = kpi.trend >= 0;
  const TrendIcon = positive ? ArrowUpRight : ArrowDownRight;
  const chartData = kpi.spark.map((v, i) => ({ i, v }));

  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/5 bg-card/60 p-5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/10 hover:shadow-[0_20px_60px_-20px_rgba(120,119,198,0.35)]">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-gradient-to-br from-primary/20 to-accent/10 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />

      <div className="flex items-start justify-between">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {kpi.label}
        </p>
        <span
          className={[
            "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            positive ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300",
          ].join(" ")}
        >
          <TrendIcon className="h-3 w-3" />
          {positive ? "+" : ""}
          {kpi.trend}%
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="text-4xl font-semibold tracking-tight text-foreground">{kpi.value}</p>
        <div className="h-10 w-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <defs>
                <linearGradient id={`spark-${kpi.label}`} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="oklch(0.68 0.19 260)" />
                  <stop offset="100%" stopColor="oklch(0.65 0.22 300)" />
                </linearGradient>
              </defs>
              <Line
                type="monotone"
                dataKey="v"
                stroke={`url(#spark-${kpi.label})`}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">vs. semana anterior</p>
    </div>
  );
}
