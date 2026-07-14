import type { JSX } from "react";

interface Props {
  titulo: string;
  valor: string | number;
  detalle?: string;
  icono?: (props: { size?: number }) => JSX.Element;
  /** Texto de tendencia bajo el valor (ej. "+21.4% MoM"). */
  tendencia?: string;
  /** Dirección de la tendencia: colorea y elige la flecha. */
  direccion?: "sube" | "baja" | "neutral";
}

/** Tarjeta de métrica: número protagonista, icono en chip y línea de tendencia. */
export function MetricCard({ titulo, valor, detalle, icono: Icono, tendencia, direccion = "neutral" }: Props) {
  const colorTendencia =
    direccion === "sube" ? "var(--good)" : direccion === "baja" ? "var(--bad)" : "var(--text-muted)";
  const flecha = direccion === "sube" ? "↗" : direccion === "baja" ? "↘" : "";

  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <p className="eyebrow">{titulo}</p>
        {Icono && (
          <span className="icon-chip">
            <Icono size={17} />
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
        {valor}
      </p>
      {tendencia && (
        <p className="mt-2 text-xs font-medium" style={{ color: colorTendencia }}>
          {flecha} {tendencia}
        </p>
      )}
      {detalle && !tendencia && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          {detalle}
        </p>
      )}
    </div>
  );
}
