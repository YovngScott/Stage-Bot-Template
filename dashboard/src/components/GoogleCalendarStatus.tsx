import { useEffect, useState } from "react";
import { adminFetch, getApiUrl } from "../lib/api";
import { IconCalendar, IconCheck, IconWarning } from "./Icons";

const API_URL = getApiUrl();

interface EstadoCalendar {
  credencialesConfiguradas: boolean;
  conectado: boolean;
  calendarId: string;
  cuentaEmail: string | null;
  error: string | null;
}

/**
 * Panel de conexión de Google Calendar. El Client ID/Secret de la app OAuth
 * es UNA SOLA para toda la plataforma (variable de entorno del backend,
 * GOOGLE_OAUTH_CLIENT_ID/SECRET) — este cliente solo necesita autorizar con
 * SU cuenta de Google; no pega ninguna credencial aquí.
 */
export function GoogleCalendarStatus() {
  const [estado, setEstado] = useState<EstadoCalendar | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);
  const [conectando, setConectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);

  async function consultar() {
    if (!API_URL) {
      setErrorConexion("Falta configurar VITE_API_URL en el .env del dashboard.");
      setCargando(false);
      return;
    }
    try {
      const res = await adminFetch("/calendar/status");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setEstado(await res.json());
      setErrorConexion(null);
    } catch {
      setErrorConexion("No se pudo consultar el estado de Google Calendar. ¿Está corriendo el backend?");
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
      const res = await adminFetch("/calendar/auth-url");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setErrorConexion(e?.message ?? "No se pudo iniciar la conexión con Google.");
    } finally {
      setConectando(false);
    }
  }

  async function desconectar() {
    if (!confirm("¿Desconectar Google Calendar? El bot dejará de crear citas ahí hasta que vuelvas a conectarlo.")) return;
    setDesconectando(true);
    try {
      const res = await adminFetch("/calendar/desconectar", { method: "POST" });
      if (!res.ok) throw new Error((await res.json())?.error ?? `Error ${res.status}`);
      await consultar();
    } catch (e: any) {
      setErrorConexion(e?.message ?? "No se pudo desconectar.");
    } finally {
      setDesconectando(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
          <IconCalendar />
          Conexión de Google Calendar
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

      {estado && !cargando && (
        <div className="mt-2 flex items-center gap-2">
          {estado.conectado ? (
            <IconCheck className="shrink-0" style={{ color: "var(--good)" }} />
          ) : (
            <IconWarning className="shrink-0" style={{ color: "var(--bad)" }} />
          )}
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {estado.conectado
              ? `Conectado${estado.cuentaEmail ? ` como ${estado.cuentaEmail}` : ""} — las citas se crean en el calendario "${estado.calendarId}".`
              : `Sin conectar${estado.error ? `: ${estado.error}` : ""}`}
          </p>
        </div>
      )}

      {estado && !cargando && estado.credencialesConfiguradas && (
        <div className="mt-4 flex gap-2">
          {!estado.conectado && (
            <button
              type="button"
              onClick={conectar}
              disabled={conectando}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              style={{ background: "var(--accent)" }}
            >
              {conectando ? "Abriendo Google…" : "Conectar con Google"}
            </button>
          )}
          {estado.conectado && (
            <button
              type="button"
              onClick={desconectar}
              disabled={desconectando}
              className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
              style={{ borderColor: "var(--border-strong)", color: "var(--bad)" }}
            >
              {desconectando ? "Desconectando…" : "Desconectar"}
            </button>
          )}
        </div>
      )}

      {estado && !cargando && !estado.credencialesConfiguradas && (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          El backend no tiene configurado GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET todavía (variable de
          entorno, una sola vez para toda la plataforma — no por cliente).
        </p>
      )}

      {estado && !cargando && estado.credencialesConfiguradas && !estado.conectado && (
        <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
          Se abrirá una pestaña de Google para iniciar sesión y autorizar el acceso al calendario. Al terminar, cierra
          esa pestaña y vuelve aquí — el estado se actualiza solo.
        </p>
      )}
    </div>
  );
}
