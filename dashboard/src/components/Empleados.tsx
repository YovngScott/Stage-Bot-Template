import { useEffect, useState } from "react";
import { adminFetch, getApiUrl } from "../lib/api";
import { IconWarning } from "./Icons";

const API_URL = getApiUrl();

interface Empleado {
  id: string;
  nombre: string;
  telefono: string;
  activo: boolean;
  creado_en: string;
}

/**
 * Números personales del equipo que reciben las alertas por WhatsApp
 * (solicitudes de atención humana, stock bajo/agotado). Se administran acá
 * y nunca se exponen por la conexión de solo lectura del dashboard: todo
 * pasa por el backend con el token de administrador.
 */
export function Empleados() {
  const [empleados, setEmpleados] = useState<Empleado[]>([]);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    if (!API_URL) return;
    try {
      const res = await adminFetch("/empleados");
      if (!res.ok) return;
      setEmpleados(await res.json());
    } catch {
      // silencioso: no bloquear el resto del dashboard
    }
  }

  useEffect(() => {
    cargar();
  }, []);

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!API_URL) {
      setError("Falta configurar VITE_API_URL en el dashboard.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await adminFetch("/empleados", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre, telefono }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      setNombre("");
      setTelefono("");
      await cargar();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo agregar el empleado.");
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(empleado: Empleado) {
    if (!API_URL) return;
    try {
      const res = await adminFetch(`/empleados/${empleado.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activo: !empleado.activo }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `Error ${res.status}`);
      await cargar();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo actualizar el empleado.");
    }
  }

  async function eliminar(empleado: Empleado) {
    if (!API_URL) return;
    if (!confirm(`¿Quitar a ${empleado.nombre} de las alertas?`)) return;
    try {
      const res = await adminFetch(`/empleados/${empleado.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `Error ${res.status}`);
      await cargar();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo eliminar el empleado.");
    }
  }

  return (
    <section className="card mb-6 p-5">
      <h2 className="mb-1 text-base font-semibold">Empleados y alertas</h2>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Estos números reciben un WhatsApp automático cuando un cliente pide hablar con una persona, o cuando una
        pieza queda con poco stock (≤3) o se agota.
      </p>

      <form onSubmit={agregar} className="mb-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--baseline)" }}
        />
        <input
          type="text"
          placeholder="Número, ej. 18498636074"
          value={telefono}
          onChange={(e) => setTelefono(e.target.value)}
          required
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--baseline)" }}
        />
        <button
          type="submit"
          disabled={guardando}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          style={{ background: "var(--series-1)" }}
        >
          {guardando ? "Agregando…" : "Agregar"}
        </button>
      </form>

      {empleados.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Todavía no hay empleados configurados: no se enviará ninguna alerta.
        </p>
      ) : (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {empleados.map((empleado) => (
            <li key={empleado.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div>
                <span className="font-medium">{empleado.nombre}</span>{" "}
                <span style={{ color: "var(--text-secondary)" }}>{empleado.telefono}</span>
                {!empleado.activo && (
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    (pausado)
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => alternarActivo(empleado)}
                  className="rounded-md border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)" }}
                >
                  {empleado.activo ? "Pausar" : "Activar"}
                </button>
                <button
                  type="button"
                  onClick={() => eliminar(empleado)}
                  className="rounded-md border px-2 py-1 text-xs"
                  style={{ borderColor: "var(--border)", color: "#d03b3b" }}
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "#d03b3b" }}>
          <IconWarning /> {error}
        </p>
      )}
    </section>
  );
}
