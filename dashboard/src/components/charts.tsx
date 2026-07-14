import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import type { ClientesPorDia, ConsultaPorCategoria, ServicioPreguntado } from "../lib/supabase";

/* Tokens leídos de las CSS custom properties para que los gráficos
   respeten el modo claro/oscuro. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const tooltipStyle = () => ({
  background: token("--surface-2"),
  border: `1px solid ${token("--border-strong")}`,
  borderRadius: 10,
  color: token("--text-primary"),
  fontSize: 12,
  padding: "8px 12px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
});

const labelStyle = () => ({ color: token("--text-muted"), marginBottom: 4, fontWeight: 600 });

const ejes = () => ({
  stroke: token("--baseline"),
  tick: { fill: token("--text-muted"), fontSize: 11 },
});

function ChartCard({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="mb-4">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {titulo}
        </h2>
        {subtitulo && (
          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {subtitulo}
          </p>
        )}
      </div>
      <div className="h-64">{children}</div>
    </div>
  );
}

/** Área: clientes que escribieron y clientes nuevos por día (relleno degradado, estilo consola). */
export function ClientesPorDiaChart({ data }: { data: ClientesPorDia[] }) {
  const formateada = data.map((d) => ({
    ...d,
    dia: new Date(d.dia + "T00:00:00").toLocaleDateString("es", { day: "numeric", month: "short" }),
  }));
  return (
    <ChartCard titulo="Clientes por día" subtitulo="Últimos 30 días — escribieron vs. nuevos">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formateada} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="gradEscribieron" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={token("--series-1")} stopOpacity={0.35} />
              <stop offset="100%" stopColor={token("--series-1")} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradNuevos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={token("--series-2")} stopOpacity={0.3} />
              <stop offset="100%" stopColor={token("--series-2")} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={token("--grid")} vertical={false} strokeDasharray="3 5" />
          <XAxis dataKey="dia" {...ejes()} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis {...ejes()} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle()} labelStyle={labelStyle()} cursor={{ stroke: token("--baseline") }} />
          <Legend
            iconType="circle"
            wrapperStyle={{ fontSize: 12, color: token("--text-secondary"), paddingTop: 8 }}
          />
          <Area
            type="monotone"
            dataKey="activos"
            name="Escribieron"
            stroke={token("--series-1")}
            strokeWidth={2.5}
            fill="url(#gradEscribieron)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: token("--surface-1") }}
          />
          <Area
            type="monotone"
            dataKey="nuevos"
            name="Nuevos"
            stroke={token("--series-2")}
            strokeWidth={2.5}
            fill="url(#gradNuevos)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: token("--surface-1") }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** Barras horizontales con degradado: productos/servicios más preguntados. */
export function ServiciosChart({ data }: { data: ServicioPreguntado[] }) {
  return (
    <ChartCard titulo="Más preguntados" subtitulo="Veces que un cliente preguntó por esto">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id="gradBarraHorizontal" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={token("--seq-600")} />
              <stop offset="100%" stopColor={token("--seq-300")} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={token("--grid")} horizontal={false} strokeDasharray="3 5" />
          <XAxis type="number" {...ejes()} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="servicio" width={170} {...ejes()} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={tooltipStyle()}
            labelStyle={labelStyle()}
            cursor={{ fill: token("--grid"), opacity: 0.5 }}
          />
          <Bar dataKey="veces_preguntada" name="Consultas" fill="url(#gradBarraHorizontal)" radius={[0, 6, 6, 0]} barSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

const ETIQUETAS_CATEGORIA: Record<string, string> = {
  precio: "Precio",
  disponibilidad: "Disponibilidad",
  garantia: "Garantía",
  horario_ubicacion: "Horario / ubicación",
  cita: "Citas",
  envio: "Envíos",
  pago: "Pago",
  otra: "Otras",
};

/** Barras verticales con degradado: consultas por categoría. */
export function CategoriasChart({ data }: { data: ConsultaPorCategoria[] }) {
  const formateada = data.map((d) => ({
    ...d,
    etiqueta: ETIQUETAS_CATEGORIA[d.categoria] ?? d.categoria,
  }));
  return (
    <ChartCard titulo="Consultas por categoría" subtitulo="Qué preguntan más los clientes">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formateada} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="gradBarraVertical" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={token("--seq-300")} />
              <stop offset="100%" stopColor={token("--seq-600")} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={token("--grid")} vertical={false} strokeDasharray="3 5" />
          <XAxis
            dataKey="etiqueta"
            {...ejes()}
            tickLine={false}
            axisLine={false}
            interval={0}
            angle={-20}
            textAnchor="end"
            height={50}
          />
          <YAxis {...ejes()} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={tooltipStyle()}
            labelStyle={labelStyle()}
            cursor={{ fill: token("--grid"), opacity: 0.5 }}
          />
          <Bar dataKey="total" name="Consultas" radius={[6, 6, 0, 0]} barSize={30}>
            {formateada.map((_, i) => (
              <Cell key={i} fill="url(#gradBarraVertical)" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
