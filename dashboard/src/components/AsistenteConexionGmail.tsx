import { useEffect, useState } from "react";
import { adminFetch, getApiUrl } from "../lib/api";
import { IconCheck, IconMail, IconWarning } from "./Icons";

const API_URL = getApiUrl();

type ProveedorCorreo = "gmail" | "microsoft" | "imap";

interface EstadoAsistente {
  configurado: boolean;
  conectado: boolean;
  proveedor: ProveedorCorreo | null;
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

/**
 * Conexión del buzón del asistente, sea cual sea el proveedor. El correo y el
 * proveedor los definió el Bot Builder al crear el bot; aquí el ejecutivo solo
 * autoriza: un clic en Gmail/Microsoft (la cuenta viene preseleccionada), o
 * los datos del servidor si es un correo corporativo por IMAP.
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
          {estado?.proveedorNombre ? `Conexión de ${estado.proveedorNombre}` : "Conexión del correo"}
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

          {!estado.conectado && estado.proveedor !== "imap" && (
            <div className="mt-4">
              <button
                type="button"
                onClick={conectar}
                disabled={conectando}
                className="rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--accent)" }}
              >
                {conectando ? "Abriendo…" : `Conectar ${estado.proveedorNombre} (${estado.correoConfigurado})`}
              </button>
              <p className="mt-3 text-xs" style={{ color: "var(--text-muted)" }}>
                Se abrirá una pestaña con {estado.correoConfigurado} ya preseleccionado. Al terminar, ciérrala
                y vuelve aquí.
              </p>
            </div>
          )}

          {/* Un correo corporativo no tiene consentimiento OAuth: se conecta
              con los datos del servidor. */}
          {!estado.conectado && estado.proveedor === "imap" && (
            <FormularioImap correo={estado.correoConfigurado ?? ""} alConectar={consultar} />
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

/**
 * Conexión de un correo corporativo por IMAP/SMTP. A diferencia de Gmail o
 * Microsoft, aquí no hay consentimiento OAuth: el ejecutivo carga los datos de
 * su servidor. La contraseña viaja al backend, que la cifra antes de guardarla
 * y nunca la devuelve.
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

  const actualizar = (campo: keyof typeof datos) => (e: { target: { value: string } }) =>
    setDatos((actual) => ({ ...actual, [campo]: e.target.value }));

  async function guardar() {
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
      const cuerpo = await res.json();
      if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
      alConectar();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo conectar con el servidor de correo.");
    } finally {
      setGuardando(false);
    }
  }

  const campo = "w-full rounded-md border px-2 py-1.5 text-sm";
  const estiloCampo = { borderColor: "var(--border-strong)", background: "transparent", color: "var(--text-primary)" };

  return (
    <div className="mt-4 rounded-lg border p-4" style={{ borderColor: "var(--border)" }}>
      <p className="text-sm font-medium">Datos de tu servidor de correo</p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Los encuentras en el panel de tu proveedor de hosting o correo. Si tu cuenta tiene verificación en dos
        pasos, usa una <strong>contraseña de aplicación</strong>, no la de tu cuenta.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span style={{ color: "var(--text-muted)" }}>Servidor IMAP</span>
          <input className={campo} style={estiloCampo} value={datos.host} onChange={actualizar("host")} placeholder="imap.midominio.com" />
        </label>
        <label className="text-xs">
          <span style={{ color: "var(--text-muted)" }}>Puerto IMAP</span>
          <input className={campo} style={estiloCampo} value={datos.puerto} onChange={actualizar("puerto")} placeholder="993" />
        </label>
        <label className="text-xs">
          <span style={{ color: "var(--text-muted)" }}>Usuario</span>
          <input className={campo} style={estiloCampo} value={datos.usuario} onChange={actualizar("usuario")} placeholder={correo} />
        </label>
        <label className="text-xs">
          <span style={{ color: "var(--text-muted)" }}>Contraseña de aplicación</span>
          <input type="password" autoComplete="off" className={campo} style={estiloCampo} value={datos.contrasena} onChange={actualizar("contrasena")} />
        </label>
        <label className="text-xs">
          <span style={{ color: "var(--text-muted)" }}>Servidor SMTP (envío)</span>
          <input className={campo} style={estiloCampo} value={datos.smtpHost} onChange={actualizar("smtpHost")} placeholder="smtp.midominio.com" />
        </label>
        <label className="text-xs">
          <span style={{ color: "var(--text-muted)" }}>Puerto SMTP</span>
          <input className={campo} style={estiloCampo} value={datos.smtpPuerto} onChange={actualizar("smtpPuerto")} placeholder="587" />
        </label>
        <label className="text-xs sm:col-span-2">
          <span style={{ color: "var(--text-muted)" }}>Carpeta de borradores</span>
          <input className={campo} style={estiloCampo} value={datos.carpetaBorradores} onChange={actualizar("carpetaBorradores")} placeholder="Drafts" />
        </label>
      </div>

      {error && (
        <p className="mt-3 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "var(--bad)" }}>
          <IconWarning /> {error}
        </p>
      )}

      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="mt-4 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        style={{ background: "var(--accent)" }}
      >
        {guardando ? "Comprobando conexión…" : "Conectar buzón"}
      </button>
      <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
        Se probará la conexión antes de guardar. Tu contraseña se almacena cifrada y no vuelve a mostrarse.
      </p>
    </div>
  );
}
