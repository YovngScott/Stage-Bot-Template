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
            Casos esperando a una persona. Los marcados «Bot en pausa» están silenciados hasta que
            los marques como atendidos; en los demás el bot sigue respondiendo.
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
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium">{cliente.nombre || "Cliente sin nombre"}</p>
                {/* El equipo necesita saber si el chat quedó mudo o si el bot
                    sigue acompañando al cliente mientras alguien lo atiende. */}
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={
                    cliente.estado === "requiere_humano"
                      ? { background: "rgba(208,59,59,.15)", color: "#d03b3b" }
                      : { background: "var(--baseline)", color: "var(--text-muted)" }
                  }
                >
                  {cliente.estado === "requiere_humano" ? "Bot en pausa" : "Escalado por el bot"}
                </span>
              </div>
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
