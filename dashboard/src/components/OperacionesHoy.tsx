import type { CitaProxima, ServicioStock } from "../hooks/useDashboardData";
import { IconCalendar, IconWarning } from "./Icons";

interface Props {
  proximasCitas: CitaProxima[];
  stockBajo: ServicioStock[];
}

function fechaCorta(fecha: string): string {
  const d = new Date(fecha);
  const hoy = new Date();
  const manana = new Date();
  manana.setDate(hoy.getDate() + 1);

  const mismoDia = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const hora = new Intl.DateTimeFormat("es-DO", { hour: "2-digit", minute: "2-digit" }).format(d);

  if (mismoDia(d, hoy)) return `Hoy · ${hora}`;
  if (mismoDia(d, manana)) return `Mañana · ${hora}`;
  return `${new Intl.DateTimeFormat("es-DO", { day: "numeric", month: "short" }).format(d)} · ${hora}`;
}

/** Panel operativo: próximas citas + productos/servicios con poco/ningún stock. */
export function OperacionesHoy({ proximasCitas, stockBajo }: Props) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5">
        <h2 className="mb-0.5 flex items-center gap-2 text-sm font-semibold">
          <IconCalendar size={16} /> Próximas citas
        </h2>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Agendadas de aquí en adelante
        </p>
        {proximasCitas.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            No hay citas próximas.
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {proximasCitas.map((cita, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-3 border-t py-2.5 text-sm first:border-t-0"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{cita.cliente}</span>
                  <span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                    {cita.motivo}
                  </span>
                </span>
                <span
                  className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {fechaCorta(cita.inicio)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card p-5">
        <h2 className="mb-0.5 flex items-center gap-2 text-sm font-semibold">
          <IconWarning size={16} /> Por reponer
        </h2>
        <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          Con 3 o menos en stock (o agotados)
        </p>
        {stockBajo.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Todo el catálogo está por encima del mínimo. ✅
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
            {stockBajo.map((s) => {
              const agotado = s.stock === 0;
              return (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 border-t py-2.5 text-sm first:border-t-0"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.nombre}</span>
                    {s.categoria && (
                      <span className="block text-xs" style={{ color: "var(--text-muted)" }}>
                        {s.categoria}
                      </span>
                    )}
                  </span>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
                    style={
                      agotado
                        ? { background: "rgba(248,113,113,0.15)", color: "var(--bad)" }
                        : { background: "var(--surface-3)", color: "var(--text-secondary)" }
                    }
                  >
                    {agotado ? "Agotado" : `Quedan ${s.stock}`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
