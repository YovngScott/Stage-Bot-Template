import { useCallback, useEffect, useState } from "react";
import { adminFetch, getApiUrl } from "../lib/api";
import { MetricCard } from "./MetricCard";
import { IconCheck, IconMail, IconSparkles, IconWarning } from "./Icons";

const API_URL = getApiUrl();

interface Metricas {
  triadosHoy: number;
  descartadosAutomaticos: number;
  borradoresCreados: number;
  pendientesRevision: number;
  confianzaPromedio: number | null;
}

interface CorreoTriado {
  id: string;
  remitente: string;
  asunto: string;
  recibido_en: string;
  categoria: string | null;
  prioridad: string | null;
  confianza: number | null;
  justificacion: string | null;
  resultado: "auto" | "revision" | "omitido" | "error";
  motivo_descarte: string | null;
  borrador_id: string | null;
  alerta_enviada: boolean;
}

function fechaLegible(fecha: string): string {
  return new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(fecha));
}

const ETIQUETA_RESULTADO: Record<CorreoTriado["resultado"], { texto: string; color: string; fondo: string }> = {
  auto: { texto: "Borrador listo", color: "var(--good)", fondo: "var(--good-soft)" },
  revision: { texto: "Necesita tu criterio", color: "#b8860b", fondo: "rgba(184,134,11,.12)" },
  omitido: { texto: "Descartado", color: "var(--text-muted)", fondo: "var(--baseline)" },
  error: { texto: "No se pudo analizar", color: "var(--bad)", fondo: "rgba(208,59,59,.12)" },
};

/**
 * Panel del asistente virtual: lo que un ejecutivo necesita ver de un
 * vistazo — cuánto correo se procesó, cuántos borradores están listos, y
 * sobre todo lo que el asistente NO se atrevió a decidir por su cuenta.
 */
export function AsistentePanel() {
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [pendientes, setPendientes] = useState<CorreoTriado[]>([]);
  const [recientes, setRecientes] = useState<CorreoTriado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triando, setTriando] = useState(false);
  const [mensajeTriaje, setMensajeTriaje] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!API_URL) {
      setError("Falta configurar VITE_API_URL en el .env del dashboard.");
      setCargando(false);
      return;
    }
    try {
      const [m, r, p] = await Promise.all([
        adminFetch("/asistente/metricas"),
        adminFetch("/asistente/correos?limite=20"),
        adminFetch("/asistente/correos?limite=20&resultado=revision"),
      ]);
      if (!m.ok || !r.ok || !p.ok) throw new Error("El backend respondió con error.");
      const [dm, dr, dp] = await Promise.all([m.json(), r.json(), p.json()]);
      setMetricas(dm);
      setRecientes(dr.correos ?? []);
      setPendientes(dp.correos ?? []);
      setError(null);
    } catch {
      setError("No se pudo cargar la actividad del asistente. ¿Está corriendo el backend?");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 30_000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  async function triarAhora() {
    setTriando(true);
    setMensajeTriaje(null);
    try {
      const res = await adminFetch("/asistente/triar", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      const r = data.resumen;
      setMensajeTriaje(
        `Listo: ${r.revisados} correos revisados, ${r.borradoresCreados} borradores creados, ${r.escaladosRevision} escalados.`,
      );
      await cargar();
    } catch (e: any) {
      setMensajeTriaje(e?.message ?? "No se pudo ejecutar el triaje.");
    } finally {
      setTriando(false);
    }
  }

  return (
    <>
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard titulo="Correos triados hoy" valor={metricas?.triadosHoy ?? 0} icono={IconMail} />
        <MetricCard
          titulo="Descartados automáticos"
          valor={metricas?.descartadosAutomaticos ?? 0}
          detalle="Boletines, no-reply, correo masivo"
        />
        <MetricCard titulo="Borradores listos" valor={metricas?.borradoresCreados ?? 0} icono={IconSparkles} />
        <MetricCard
          titulo="Pendientes de tu criterio"
          valor={metricas?.pendientesRevision ?? 0}
          detalle={
            metricas?.confianzaPromedio !== null && metricas?.confianzaPromedio !== undefined
              ? `Confianza promedio: ${Math.round(metricas.confianzaPromedio * 100)}%`
              : undefined
          }
        />
      </section>

      <section className="card mb-6 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Correos que necesitan tu criterio</h2>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              El asistente redacta el resto por su cuenta. Estos los dejó intactos porque deben salir
              de tu parte —o porque no terminó de entenderlos— y te avisó por WhatsApp.
            </p>
          </div>
          <button
            type="button"
            onClick={triarAhora}
            disabled={triando}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {triando ? "Revisando bandeja…" : "Triar ahora"}
          </button>
        </div>

        {mensajeTriaje && (
          <p className="mb-3 text-sm" style={{ color: "var(--text-secondary)" }}>
            {mensajeTriaje}
          </p>
        )}

        {error && (
          <p className="flex items-center gap-1.5 text-sm" role="alert" style={{ color: "var(--bad)" }}>
            <IconWarning /> {error}
          </p>
        )}

        {!error && cargando && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Cargando…
          </p>
        )}

        {!error && !cargando && pendientes.length === 0 && (
          <p className="flex items-center gap-1.5 text-sm" style={{ color: "var(--good)" }}>
            <IconCheck /> No hay nada pendiente de tu criterio ahora mismo.
          </p>
        )}

        {!error && pendientes.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {pendientes.map((correo) => (
              <article key={correo.id} className="rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
                <p className="font-medium">{correo.asunto}</p>
                <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
                  {correo.remitente}
                </p>
                {correo.justificacion && (
                  <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {correo.justificacion}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {correo.categoria && (
                    <span className="rounded-full px-2 py-0.5" style={{ background: "var(--baseline)" }}>
                      {correo.categoria}
                    </span>
                  )}
                  {correo.confianza !== null && (
                    <span style={{ color: "var(--text-muted)" }}>{Math.round(correo.confianza * 100)}% de confianza</span>
                  )}
                  <span style={{ color: "var(--text-muted)" }}>{fechaLegible(correo.recibido_en)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-4 text-base font-semibold">Actividad reciente</h2>
        {!error && recientes.length === 0 && !cargando && (
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Todavía no hay correos triados.
          </p>
        )}
        {recientes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ color: "var(--text-muted)" }}>
                  <th className="pb-2 pr-3 font-normal">Correo</th>
                  <th className="pb-2 pr-3 font-normal">Categoría</th>
                  <th className="pb-2 pr-3 font-normal">Resultado</th>
                  <th className="pb-2 font-normal">Recibido</th>
                </tr>
              </thead>
              <tbody>
                {recientes.map((correo) => {
                  const et = ETIQUETA_RESULTADO[correo.resultado];
                  return (
                    <tr key={correo.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                      <td className="max-w-xs truncate py-2 pr-3">
                        <span className="font-medium">{correo.asunto}</span>
                        <span className="block truncate text-xs" style={{ color: "var(--text-muted)" }}>
                          {correo.remitente}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs" style={{ color: "var(--text-muted)" }}>
                        {correo.categoria ?? correo.motivo_descarte ?? "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ background: et.fondo, color: et.color }}
                        >
                          {et.texto}
                        </span>
                      </td>
                      <td className="py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                        {fechaLegible(correo.recibido_en)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
