import { useEffect, useState } from "react";
import { Calendar, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { adminFetch, getApiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface EstadoCalendar {
  credencialesConfiguradas: boolean;
  conectado: boolean;
  calendarId: string;
  cuentaEmail: string | null;
  error: string | null;
}

/**
 * Conexión de Google Calendar. El Client ID/Secret de la app OAuth es UNO
 * SOLO para toda la plataforma (variable del backend); el cliente solo
 * autoriza con SU cuenta de Google — no pega credenciales aquí.
 */
export function GoogleCalendarCard() {
  const apiConfigurada = Boolean(getApiUrl());
  const [estado, setEstado] = useState<EstadoCalendar | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function consultar() {
    if (!apiConfigurada) {
      setError("Falta configurar VITE_API_URL para conectar con el bot.");
      setCargando(false);
      return;
    }
    try {
      const res = await adminFetch("/calendar/status");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      setEstado(await res.json());
      setError(null);
    } catch {
      setError("No se pudo consultar el estado de Google Calendar.");
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    void consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function conectar() {
    setOcupado(true);
    setError(null);
    try {
      const res = await adminFetch("/calendar/auth-url");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar la conexión con Google.");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    if (!confirm("¿Desconectar Google Calendar? El bot dejará de crear citas ahí.")) return;
    setOcupado(true);
    try {
      const res = await adminFetch("/calendar/desconectar", { method: "POST" });
      if (!res.ok) throw new Error((await res.json())?.error ?? `Error ${res.status}`);
      await consultar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo desconectar.");
    } finally {
      setOcupado(false);
    }
  }

  const conectado = estado?.conectado;

  return (
    <div
      className={[
        "relative overflow-hidden rounded-2xl border p-6 backdrop-blur-xl",
        conectado
          ? "border-white/5 bg-card/60"
          : "border-amber-400/15 bg-gradient-to-br from-amber-500/[0.04] to-transparent",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
          <Calendar className="h-6 w-6" />
        </div>
        <span
          className={[
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
            conectado
              ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
              : "border-amber-400/25 bg-amber-500/10 text-amber-300",
          ].join(" ")}
        >
          <span
            className={[
              "h-1.5 w-1.5 rounded-full",
              conectado ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-amber-400",
            ].join(" ")}
          />
          {conectado ? "Conectado" : "Desconectado"}
        </span>
      </div>

      <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
        Google Calendar
      </h3>

      {cargando && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando estado…
        </p>
      )}

      {error && !cargando && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-300" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {estado && !cargando && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
          {conectado ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          ) : (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          )}
          <span>
            {conectado
              ? `Conectado${estado.cuentaEmail ? ` como ${estado.cuentaEmail}` : ""}. Las citas se crean en «${estado.calendarId}».`
              : "Autoriza el acceso para sincronizar las citas automáticamente con tu agenda."}
          </span>
        </p>
      )}

      {estado && !cargando && !estado.credencialesConfiguradas && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          El backend aún no tiene configuradas las credenciales OAuth de Google (una sola vez para
          toda la plataforma).
        </p>
      )}

      {estado && !cargando && estado.credencialesConfiguradas && (
        <div className="mt-4">
          {!conectado ? (
            <Button
              size="sm"
              onClick={conectar}
              disabled={ocupado}
              className="w-full ai-gradient-bg text-white hover:opacity-90"
            >
              {ocupado ? "Abriendo Google…" : "Conectar con Google"}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={desconectar}
              disabled={ocupado}
              className="w-full"
            >
              {ocupado ? "Desconectando…" : "Desconectar"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
