import type { PreguntaFrecuente } from "../lib/supabase";

const ETIQUETAS_CATEGORIA: Record<string, string> = {
  precio: "Precio",
  disponibilidad: "Disponibilidad",
  diagnostico: "Diagnóstico",
  placa: "Placa base",
  estado_reparacion: "Estado reparación",
  garantia: "Garantía",
  horario_ubicacion: "Horario / ubicación",
  cita: "Citas",
  envio: "Envíos",
  pago: "Pago",
  otra: "Otras",
};

/** Tabla de preguntas más repetidas (vista accesible además de los gráficos). */
export function PreguntasTable({ data }: { data: PreguntaFrecuente[] }) {
  return (
    <div className="card p-5">
      <h2 className="mb-0.5 text-sm font-semibold">Preguntas más repetidas</h2>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Agrupadas por texto exacto de la consulta
      </p>
      {data.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Aún no hay consultas registradas.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="eyebrow text-left">
              <th className="pb-2 font-semibold">Pregunta</th>
              <th className="pb-2 font-semibold">Categoría</th>
              <th className="pb-2 text-right font-semibold">Veces</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p, i) => (
              <tr
                key={i}
                className="transition-colors"
                style={{ borderTop: "1px solid var(--border)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td className="py-2.5 pr-3" style={{ color: "var(--text-primary)" }}>
                  {p.pregunta}
                </td>
                <td className="py-2.5 pr-3">
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium"
                    style={{ background: "var(--surface-3)", color: "var(--text-secondary)" }}
                  >
                    {ETIQUETAS_CATEGORIA[p.categoria] ?? p.categoria}
                  </span>
                </td>
                <td
                  className="py-2.5 text-right font-semibold"
                  style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
                >
                  {p.repeticiones}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
