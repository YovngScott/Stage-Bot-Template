import type { ClienteResumen, EmbudoEstado } from "../hooks/useDashboardData";

const ETIQUETAS_ESTADO: Record<string, string> = {
  nuevo: "Nuevo",
  interesado: "Interesado",
  cotizado: "Cotizado",
  agendado: "Con cita agendada",
  cliente: "Cliente (convertido)",
  perdido: "Perdido",
  requiere_humano: "Espera de empleado",
};

function fechaLegible(fecha: string): string {
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(fecha));
}

/** Conteo por estado del embudo (nuevo, interesado, cotizado, agendado, etc.). */
function ResumenEstados({ embudo }: { embudo: EmbudoEstado[] }) {
  const orden = ["nuevo", "interesado", "cotizado", "agendado", "cliente", "requiere_humano", "perdido"];
  const ordenados = [...embudo].sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado));

  return (
    // flex con flex:1 en cada celda → llenan todo el ancho y se reparten en
    // partes iguales; a más estados, cada uno se hace más pequeño. En pantallas
    // estrechas hacen wrap para no quedar ilegibles.
    <div className="card mb-6 flex flex-wrap gap-px overflow-hidden p-0" style={{ background: "var(--border)" }}>
      {ordenados.map((e) => (
        <div
          key={e.estado}
          className="p-4"
          style={{ background: "var(--surface-1)", flex: "1 1 110px", minWidth: 0 }}
        >
          <p className="text-2xl font-semibold">{e.total}</p>
          <p className="mt-0.5 truncate text-xs" style={{ color: "var(--text-muted)" }}>
            {ETIQUETAS_ESTADO[e.estado] ?? e.estado}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Lista de clientes en un estado dado (ej. con cita agendada). */
function ListaClientes({ titulo, descripcion, clientes }: { titulo: string; descripcion: string; clientes: ClienteResumen[] }) {
  return (
    <section className="card mb-6 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">{titulo}</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            {descripcion}
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--baseline)", color: "var(--text-primary)" }}>
          {clientes.length}
        </span>
      </div>

      {clientes.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No hay clientes en este estado.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {clientes.map((cliente) => (
            <article key={cliente.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
              <p className="font-medium">{cliente.nombre || "Cliente sin nombre"}</p>
              <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
                {cliente.telefono}
              </p>
              {cliente.notas && (
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  {cliente.notas}
                </p>
              )}
              <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                Último mensaje: {fechaLegible(cliente.ultimo_contacto)}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

interface Props {
  embudo: EmbudoEstado[];
  clientesAgendados: ClienteResumen[];
}

/** Estados de los chats: cuántos hay en cada etapa y quiénes son. */
export function EstadosChats({ embudo, clientesAgendados }: Props) {
  return (
    <div>
      <ResumenEstados embudo={embudo} />
      <ListaClientes
        titulo="Clientes con cita agendada"
        descripcion="Confirmaron fecha/hora para traer su equipo o retirarlo."
        clientes={clientesAgendados}
      />
    </div>
  );
}
