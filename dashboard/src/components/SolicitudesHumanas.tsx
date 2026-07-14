import { useState } from "react";
import { adminFetch, getApiUrl } from "../lib/api";
import type { ClienteRequiereHumano } from "../hooks/useDashboardData";
import { IconWarning } from "./Icons";

const API_URL = getApiUrl();

interface Props {
  clientes: ClienteRequiereHumano[];
  alActualizar: () => void;
}

function fechaLegible(fecha: string): string {
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(fecha));
}

/** Casos escalados: el equipo los atiende y luego libera el chat al bot. */
export function SolicitudesHumanas({ clientes, alActualizar }: Props) {
  const [procesando, setProcesando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function marcarAtendido(cliente: ClienteRequiereHumano) {
    if (!API_URL) {
      setError("Falta configurar VITE_API_URL en el dashboard.");
      return;
    }

    setProcesando(cliente.id);
    setError(null);
    try {
      const res = await adminFetch(`/whatsapp/clientes/${cliente.id}/atendido`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      alActualizar();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo marcar el caso como atendido.");
    } finally {
      setProcesando(null);
    }
  }

  return (
    <section className="card mb-6 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Solicitudes de atención humana</h2>
          <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
            Estos chats están pausados para el bot hasta que los marques como atendidos.
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: "var(--baseline)", color: "var(--text-primary)" }}>
          {clientes.length} pendiente{clientes.length === 1 ? "" : "s"}
        </span>
      </div>

      {clientes.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          No hay clientes esperando atención humana.
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
              <button
                type="button"
                onClick={() => marcarAtendido(cliente)}
                disabled={procesando !== null}
                className="mt-4 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--good)" }}
              >
                {procesando === cliente.id ? "Guardando…" : "Atendido · reactivar bot"}
              </button>
            </article>
          ))}
        </div>
      )}

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "#d03b3b" }}>
          <IconWarning /> {error}
        </p>
      )}
    </section>
  );
}
