import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CardShell } from "./CardShell";
import type { CategoryPoint, ChartPoint, FaqItem } from "@/hooks/useTenantData";

const tooltipStyle = {
  backgroundColor: "oklch(0.21 0.025 265 / 0.95)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "10px",
  color: "white",
  fontSize: "12px",
  padding: "8px 10px",
  backdropFilter: "blur(12px)",
};

export function LineClientsChart({ data }: { data: ChartPoint[] }) {
  return (
    <CardShell title="Clientes por día">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="lineFill" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="oklch(0.68 0.19 260)" />
                <stop offset="100%" stopColor="oklch(0.65 0.22 300)" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="day"
              stroke="oklch(0.68 0.02 260)"
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              stroke="oklch(0.68 0.02 260)"
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />
            <Line
              type="monotone"
              dataKey="clientes"
              stroke="url(#lineFill)"
              strokeWidth={2.5}
              dot={{ r: 3, fill: "oklch(0.68 0.19 260)", strokeWidth: 0 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </CardShell>
  );
}

const barColors = [
  "oklch(0.68 0.19 260)",
  "oklch(0.65 0.22 300)",
  "oklch(0.72 0.17 200)",
  "oklch(0.78 0.16 150)",
  "oklch(0.75 0.19 60)",
];

export function CategoriesChart({ data }: { data: CategoryPoint[] }) {
  return (
    <CardShell title="Consultas por categoría">
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
            <XAxis
              dataKey="category"
              stroke="oklch(0.68 0.02 260)"
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              stroke="oklch(0.68 0.02 260)"
              tick={{ fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={barColors[i % barColors.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardShell>
  );
}

export function FaqList({ items }: { items: FaqItem[] }) {
  const max = Math.max(...items.map((i) => i.count));
  return (
    <CardShell title="Preguntas más repetidas">
      <ul className="space-y-3">
        {items.map((f) => (
          <li key={f.question} className="group">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm text-foreground/90">{f.question}</p>
              <span className="text-xs font-medium text-muted-foreground">{f.count}</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
              <div
                className="h-full rounded-full ai-gradient-bg transition-all duration-500"
                style={{ width: `${(f.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}
