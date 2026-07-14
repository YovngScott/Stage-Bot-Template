import { useEffect, useState } from "react";
import { adminFetch, getApiUrl } from "../lib/api";
import { IconWarning, IconWhatsApp } from "./Icons";

const API_URL = getApiUrl();

interface EstadoWhatsApp {
  conectado: boolean;
  numero: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  actualizadoEn: number;
}

/**
 * Panel de conexión de WhatsApp: muestra el QR o permite pedir un código de
 * emparejamiento por número de teléfono, sin tocar la terminal del servidor.
 * Se actualiza solo cada 3 segundos mientras no esté conectado.
 */
export function WhatsAppStatus() {
  const [estado, setEstado] = useState<EstadoWhatsApp | null>(null);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [pidiendoCodigo, setPidiendoCodigo] = useState(false);
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);

  useEffect(() => {
    if (!API_URL) {
      setErrorConexion("Falta configurar VITE_API_URL en el .env del dashboard.");
      return;
    }

    let cancelado = false;
    async function consultar() {
      try {
        const res = await adminFetch("/whatsapp/status");
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const data = (await res.json()) as EstadoWhatsApp;
        if (!cancelado) {
          setEstado(data);
          setErrorConexion(null);
        }
      } catch (e: any) {
        if (!cancelado) {
          setErrorConexion("No se pudo conectar con el backend. ¿Está corriendo `npm run dev` en la carpeta backend?");
        }
      }
    }

    consultar();
    const intervalo = setInterval(consultar, 3000);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, []);

  async function pedirCodigo(e: React.FormEvent) {
    e.preventDefault();
    setErrorCodigo(null);
    setPidiendoCodigo(true);
    try {
      const res = await adminFetch("/whatsapp/solicitar-codigo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      // El próximo sondeo de /status ya trae el pairingCode actualizado,
      // pero lo reflejamos de inmediato para que se sienta instantáneo.
      setEstado((prev) => (prev ? { ...prev, pairingCode: data.codigo } : prev));
    } catch (e: any) {
      setErrorCodigo(e?.message ?? "No se pudo pedir el código.");
    } finally {
      setPidiendoCodigo(false);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        <IconWhatsApp />
        Conexión de WhatsApp
      </h2>

      {errorConexion && (
        <p className="mt-2 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "#d03b3b" }}>
          <IconWarning /> {errorConexion}
        </p>
      )}

      {!errorConexion && !estado && (
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          Consultando estado…
        </p>
      )}

      {estado?.conectado && (
        <div className="mt-2 flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ background: "var(--good)" }}
            aria-hidden
          />
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            Conectado{estado.numero && ` — +${estado.numero}`}. El bot ya está respondiendo mensajes.
          </p>
        </div>
      )}

      {estado && !estado.conectado && (
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          {/* Opción 1: escanear QR */}
          <div>
            <p className="mb-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              Opción 1 — Escanear código QR
            </p>
            {estado.qrDataUrl ? (
              <img
                src={estado.qrDataUrl}
                alt="Código QR para vincular WhatsApp"
                className="w-full max-w-[220px] rounded-lg border"
                style={{ borderColor: "var(--border)" }}
              />
            ) : (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Generando código QR…
              </p>
            )}
            <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
              WhatsApp → Configuración → Dispositivos vinculados → Vincular un dispositivo → escanea con la cámara.
            </p>
          </div>

          {/* Opción 2: código de emparejamiento */}
          <div>
            <p className="mb-2 text-sm" style={{ color: "var(--text-secondary)" }}>
              Opción 2 — Código de emparejamiento
            </p>
            <form onSubmit={pedirCodigo} className="flex gap-2">
              <input
                type="tel"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="18498636074"
                className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--baseline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
                required
              />
              <button
                type="submit"
                disabled={pidiendoCodigo}
                className="shrink-0 rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "var(--series-1)" }}
              >
                {pidiendoCodigo ? "Pidiendo…" : "Pedir código"}
              </button>
            </form>
            <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              Con código de país, sin espacios ni '+'. Ej: 18498636074.
            </p>

            {estado.pairingCode && (
              <p className="mt-3 text-2xl font-semibold tracking-wider" style={{ color: "var(--series-1)" }}>
                {estado.pairingCode}
              </p>
            )}
            {estado.pairingCode && (
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Ingresa este código en WhatsApp → Dispositivos vinculados → Vincular con número de teléfono. Expira
                en ~60 segundos — si se vence, pide uno nuevo.
              </p>
            )}
            {errorCodigo && (
              <p className="mt-2 text-xs" role="alert" style={{ color: "#d03b3b" }}>
                {errorCodigo}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
