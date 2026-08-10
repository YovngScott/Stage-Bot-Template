import { useEffect, useState } from "react";
import { MessageCircle, AlertCircle, Loader2 } from "lucide-react";
import { adminFetch, getApiUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EstadoWhatsApp {
  conectado: boolean;
  numero: string | null;
  qrDataUrl: string | null;
  pairingCode: string | null;
  actualizadoEn: number;
}

/**
 * Conexión de WhatsApp: número conectado, o el QR / código de emparejamiento
 * para vincular. Sondea /whatsapp/status cada 3s mientras no esté conectado.
 * Todo pasa por el backend del tenant con el token de administrador.
 */
export function WhatsAppCard() {
  const apiConfigurada = Boolean(getApiUrl());
  const [estado, setEstado] = useState<EstadoWhatsApp | null>(null);
  const [errorConexion, setErrorConexion] = useState<string | null>(null);
  const [numero, setNumero] = useState("");
  const [pidiendo, setPidiendo] = useState(false);
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);

  useEffect(() => {
    if (!apiConfigurada) {
      setErrorConexion("Falta configurar VITE_API_URL para conectar con el bot.");
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
      } catch {
        if (!cancelado) setErrorConexion("No se pudo conectar con el backend del bot.");
      }
    }
    void consultar();
    const intervalo = setInterval(consultar, 3000);
    return () => {
      cancelado = true;
      clearInterval(intervalo);
    };
  }, [apiConfigurada]);

  async function pedirCodigo(e: React.FormEvent) {
    e.preventDefault();
    setErrorCodigo(null);
    setPidiendo(true);
    try {
      const res = await adminFetch("/whatsapp/solicitar-codigo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      setEstado((prev) => (prev ? { ...prev, pairingCode: data.codigo } : prev));
    } catch (err) {
      setErrorCodigo(err instanceof Error ? err.message : "No se pudo pedir el código.");
    } finally {
      setPidiendo(false);
    }
  }

  const conectado = estado?.conectado;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-card/60 p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="flex items-center justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
          <MessageCircle className="h-6 w-6" />
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
          {conectado ? "Conectado" : "Sin conectar"}
        </span>
      </div>

      <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
        WhatsApp Business
      </h3>

      {errorConexion && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-300" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" /> {errorConexion}
        </p>
      )}

      {!errorConexion && !estado && (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando estado…
        </p>
      )}

      {conectado && (
        <p className="mt-3 text-sm text-foreground">
          Bot activo{estado?.numero && <span className="font-mono"> — +{estado.numero}</span>}. Ya
          está respondiendo mensajes.
        </p>
      )}

      {estado && !conectado && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Opción 1 · Escanear QR</p>
            {estado.qrDataUrl ? (
              <img
                src={estado.qrDataUrl}
                alt="Código QR para vincular WhatsApp"
                className="w-full max-w-[200px] rounded-lg border border-white/10 bg-white p-2"
              />
            ) : (
              <p className="text-xs text-muted-foreground">Generando código QR…</p>
            )}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Opción 2 · Código de emparejamiento
            </p>
            <form onSubmit={pedirCodigo} className="flex gap-2">
              <Input
                type="tel"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                placeholder="18498636074"
                required
                className="bg-white/[0.03] border-white/10"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={pidiendo}
                className="shrink-0"
              >
                {pidiendo ? "Pidiendo…" : "Pedir código"}
              </Button>
            </form>
            {estado.pairingCode && (
              <p className="mt-3 text-2xl font-semibold tracking-[0.3em] text-primary">
                {estado.pairingCode}
              </p>
            )}
            {errorCodigo && (
              <p className="mt-2 text-xs text-rose-300" role="alert">
                {errorCodigo}
              </p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              Con código de país, sin espacios ni «+». El código expira en ~60s.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
