import { useEffect, useState } from "react";
import { adminFetch, getApiUrl } from "../lib/api";
import { IconCheck, IconMail, IconWarning } from "./Icons";

const API_URL = getApiUrl();

interface EstadoAsistente {
  configurado: boolean;
  conectado: boolean;
  error: string | null;
  cuentaCoincide: boolean | null;
  correoConfigurado: string | null;
  correoConectado: string | null;
  umbralConfianza: number | null;
  intervaloMinutos: number | null;
  horaReporte: string | null;
  actuaComoTitular: boolean | null;
  nombreTitular: string | null;
  enviarAutomatico: boolean | null;
}

/**
 * Conexión de Gmail del asistente. El correo a atender lo definió el Bot
 * Builder al crear el bot — aquí solo se autoriza esa cuenta con un clic
 * (Google ya la preselecciona por el login_hint que manda el backend).
 */
export function AsistenteConexionGmail() {
  const [estado, setEstado] = useState<EstadoAsistente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);

  async function consultar() {
    if (!API_URL) {
      setErrorConexion("Falta configurar VITE_API_URL en el .env del dashboard.");
      setCargando(false);
      return;
    }
    try {
      const res = await adminFetch("/asistente/estado");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setEstado(await res.json());
      setErrorConexion(null);
    } catch {
      setErrorConexion("No se pudo consultar el estado del asistente. ¿Está corriendo el backend?");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    consultar();
  }, []);

  async function conectar() {
    setConectando(true);
    setErrorConexion(null);
    try {
      const res = await adminFetch("/asistente/auth-url");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setErrorConexion(e?.message ?? "No se pudo iniciar la conexión con Google.");
    } finally {
      setConectando(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          <IconMail />
          Conexión de Gmail
        </h2>
        <button
          type="button"
          onClick={() => {
            setCargando(true);
            consultar();
          }}
          className="text-xs underline"
          style={{ color: "var(--text-muted)" }}
        >
          Revisar de nuevo
        </button>
      </div>

      {cargando && (
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Consultando estado…
        </p>
      )}

      {errorConexion && !cargando && (
        <p className="mt-2 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "var(--bad)" }}>
          <IconWarning /> {errorConexion}
        </p>
      )}

      {estado && !cargando && !estado.configurado && (
        <p className="mt-2 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "var(--bad)" }}>
          <IconWarning /> {estado.error ?? "Falta configurar el correo del asistente."}
        </p>
      )}

      {estado && !cargando && estado.configurado && (
        <>
          <div className="mt-2 flex items-center gap-2">
            {estado.conectado ? (
              <IconCheck className="shrink-0" style={{ color: "var(--good)" }} />
            ) : (
              <IconWarning className="shrink-0" style={{ color: "var(--bad)" }} />
            )}
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              {estado.conectado
                ? `Conectado como ${estado.correoConectado} — así triamos esta bandeja.`
                : `Sin conectar. Este asistente debe atender: ${estado.correoConfigurado}`}
            </p>
          </div>

          {estado.conectado && estado.cuentaCoincide === false && (
            <p className="mt-2 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "var(--bad)" }}>
              <IconWarning /> Autorizaste <strong>{estado.correoConectado}</strong>, pero este bot debe atender{" "}
              <strong>{estado.correoConfigurado}</strong>. Desconecta y vuelve a autorizar con la cuenta correcta.
            </p>
          )}

          {!estado.conectado && (
            <div className="mt-4">
              <button
                type="button"
                onClick={conectar}
                disabled={conectando}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {conectando ? "Abriendo Google…" : `Conectar Gmail (${estado.correoConfigurado})`}
              </button>
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Se abrirá una pestaña de Google con {estado.correoConfigurado} ya preseleccionado. Al terminar,
                cierra esa pestaña y vuelve aquí.
              </p>
            </div>
          )}

          {estado.conectado && (
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
              <div>
                <dt style={{ color: "var(--text-muted)" }}>Umbral de confianza</dt>
                <dd className="font-medium">{Math.round((estado.umbralConfianza ?? 0.7) * 100)}%</dd>
              </div>
              <div>
                <dt style={{ color: "var(--text-muted)" }}>Revisa cada</dt>
                <dd className="font-medium">{estado.intervaloMinutos ?? 10} min</dd>
              </div>
              <div>
                <dt style={{ color: "var(--text-muted)" }}>Reporte diario</dt>
                <dd className="font-medium">{estado.horaReporte ?? "18:00"}</dd>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <dt style={{ color: "var(--text-muted)" }}>Cómo responde</dt>
                <dd className="font-medium">
                  {estado.enviarAutomatico
                    ? "Lo rutinario lo responde y lo envía solo. Lo delicado y lo que no entienda te lo deja como borrador para que lo revises y lo mandes tú."
                    : "Nunca envía: todo queda como borrador en tu bandeja para que lo revises."}
                </dd>
              </div>
              <div className="col-span-2 sm:col-span-3">
                <dt style={{ color: "var(--text-muted)" }}>Firma</dt>
                <dd className="font-medium">
                  {estado.actuaComoTitular
                    ? `A nombre de ${estado.nombreTitular}, sin mencionar que hay un asistente.`
                    : "Se identifica como tu asistente."}
                </dd>
              </div>
            </dl>
          )}
        </>
      )}
    </div>
  );
}
