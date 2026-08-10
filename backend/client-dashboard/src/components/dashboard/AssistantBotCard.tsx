import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, Mail } from "lucide-react";
import { adminFetch, getApiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Conexión del buzón que atiende el asistente. El correo y el proveedor los
 * fijó el Bot Builder al crear el bot; aquí el ejecutivo solo autoriza: un
 * clic si es Gmail/Microsoft (la cuenta va preseleccionada), o los datos del
 * servidor si es un correo corporativo por IMAP.
 */

type Proveedor = "gmail" | "microsoft" | "imap";

export interface EstadoAsistente {
  configurado: boolean;
  conectado: boolean;
  proveedor: Proveedor | null;
  proveedorNombre: string | null;
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

/** Estado del asistente. Lo comparten la tarjeta de conexión y el panel de triaje. */
export function useEstadoAsistente() {
  const [estado, setEstado] = useState<EstadoAsistente | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const consultar = useCallback(async () => {
    if (!getApiUrl()) {
      setError("Falta configurar la dirección del backend de este cliente.");
      setCargando(false);
      return;
    }
    try {
      const res = await adminFetch("/asistente/estado");
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
      setEstado(cuerpo as EstadoAsistente);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar el estado del asistente.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void consultar();
  }, [consultar]);

  return { estado, cargando, error, recargar: consultar };
}

export function AssistantBotCard() {
  const { estado, cargando, error, recargar } = useEstadoAsistente();
  const [conectando, setConectando] = useState(false);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  async function conectar() {
    setConectando(true);
    setErrorAccion(null);
    try {
      const res = await adminFetch("/asistente/auth-url");
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
      window.open(cuerpo.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : "No se pudo iniciar la conexión.");
    } finally {
      setConectando(false);
    }
  }

  const conectado = Boolean(estado?.conectado);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-card/60 p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-violet-400/20 blur-3xl" />
      <div className="flex items-center justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
          <Mail className="h-6 w-6" />
        </div>
        {cargando ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Comprobando
          </span>
        ) : conectado ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Sin conectar
          </span>
        )}
      </div>

      <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
        {estado?.proveedorNombre ?? "Buzón de correo"}
      </h3>

      {(error || errorAccion) && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {errorAccion ?? error}
        </p>
      )}

      {estado && !estado.configurado && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-300">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {estado.error ?? "Falta definir el correo que este asistente debe atender."}
        </p>
      )}

      {estado?.configurado && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {conectado
              ? `Atendiendo ${estado.correoConectado}.`
              : `Este asistente debe atender ${estado.correoConfigurado}.`}
          </p>

          {conectado && estado.cuentaCoincide === false && (
            <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Autorizaste <strong>{estado.correoConectado}</strong>, pero debía ser{" "}
              <strong>{estado.correoConfigurado}</strong>. Vuelve a conectar con la cuenta correcta.
            </p>
          )}

          {!conectado && estado.proveedor !== "imap" && (
            <Button
              onClick={() => void conectar()}
              disabled={conectando}
              className="ai-gradient-bg mt-4 w-full text-white hover:opacity-90"
            >
              {conectando ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Abriendo…
                </>
              ) : (
                `Conectar ${estado.proveedorNombre}`
              )}
            </Button>
          )}

          {!conectado && estado.proveedor === "imap" && (
            <FormularioImap correo={estado.correoConfigurado ?? ""} alConectar={recargar} />
          )}

          {conectado && (
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-white/5 pt-4 text-xs">
              <div>
                <dt className="text-muted-foreground">Revisa cada</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {estado.intervaloMinutos ?? 10} min
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reporte diario</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {estado.horaReporte ?? "18:00"}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Cómo responde</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {estado.enviarAutomatico
                    ? "Lo rutinario lo envía solo; lo delicado te lo deja como borrador."
                    : "Nunca envía: todo queda como borrador para que lo revises."}
                </dd>
              </div>
              <div className="col-span-2">
                <dt className="text-muted-foreground">Firma</dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {estado.actuaComoTitular
                    ? `A nombre de ${estado.nombreTitular}.`
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

/**
 * Un correo corporativo no tiene consentimiento OAuth: se conecta con los
 * datos del servidor. La contraseña viaja al backend, que la cifra antes de
 * guardarla y nunca la devuelve.
 */
function FormularioImap({ correo, alConectar }: { correo: string; alConectar: () => void }) {
  const [datos, setDatos] = useState({
    host: "",
    puerto: "993",
    usuario: correo,
    contrasena: "",
    smtpHost: "",
    smtpPuerto: "587",
    carpetaBorradores: "Drafts",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (campo: keyof typeof datos) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDatos((actual) => ({ ...actual, [campo]: e.target.value }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      const res = await adminFetch("/asistente/credenciales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...datos,
          puerto: Number(datos.puerto),
          smtpPuerto: Number(datos.smtpPuerto),
        }),
      });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
      alConectar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo conectar con el servidor de correo.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={(e) => void guardar(e)} className="mt-4 border-t border-white/5 pt-4">
      <p className="text-xs text-muted-foreground">
        Estos datos están en el panel de tu proveedor de correo. Si tu cuenta tiene verificación en
        dos pasos, usa una <strong>contraseña de aplicación</strong>, no la de tu cuenta.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Servidor IMAP</Label>
          <Input value={datos.host} onChange={set("host")} placeholder="imap.midominio.com" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Puerto IMAP</Label>
          <Input value={datos.puerto} onChange={set("puerto")} placeholder="993" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Usuario</Label>
          <Input value={datos.usuario} onChange={set("usuario")} placeholder={correo} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Contraseña de aplicación</Label>
          <Input
            type="password"
            autoComplete="off"
            value={datos.contrasena}
            onChange={set("contrasena")}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Servidor SMTP</Label>
          <Input
            value={datos.smtpHost}
            onChange={set("smtpHost")}
            placeholder="smtp.midominio.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Puerto SMTP</Label>
          <Input value={datos.smtpPuerto} onChange={set("smtpPuerto")} placeholder="587" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">Carpeta de borradores</Label>
          <Input
            value={datos.carpetaBorradores}
            onChange={set("carpetaBorradores")}
            placeholder="Drafts"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      <Button
        type="submit"
        disabled={guardando}
        className="ai-gradient-bg mt-4 w-full text-white hover:opacity-90"
      >
        {guardando ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Comprobando conexión…
          </>
        ) : (
          <>
            <CheckCircle2 className="mr-2 h-4 w-4" /> Conectar buzón
          </>
        )}
      </Button>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Se prueba la conexión antes de guardar. Tu contraseña se almacena cifrada y no vuelve a
        mostrarse.
      </p>
    </form>
  );
}
