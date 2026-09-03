import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { supabase, TENANT_SLUG } from "../lib/supabase";
import { IconWhatsApp, IconWarning } from "./Icons";

export type ConnectionStatus =
  | "qr_ready"
  | "connecting"
  | "open"
  | "disconnected"
  | string;

export interface ClientBotState {
  connection_status: ConnectionStatus;
  connection_qr: string | null;
  updated_at?: string;
}

interface WhatsAppConexionesProps {
  tenantSlug?: string;
  className?: string;
}

/**
 * Componente React para la vista 'Conexiones' del Dashboard.
 * Se suscribe en tiempo real vía Supabase Realtime a los cambios de conexión
 * del bot para el tenant actual, renderizando el QR dinámico o el estado activo.
 */
export function WhatsAppConexiones({
  tenantSlug = TENANT_SLUG,
  className = "",
}: WhatsAppConexionesProps) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorSupabase, setErrorSupabase] = useState<string | null>(null);
  const [ultimoCambio, setUltimoCambio] = useState<Date | null>(null);

  useEffect(() => {
    if (!tenantSlug) {
      setErrorSupabase("No se detectó el identificador (slug) del tenant.");
      setCargando(false);
      return;
    }

    let montado = true;

    // 1. Obtener estado inicial desde Supabase
    async function obtenerEstadoInicial() {
      try {
        const { data, error } = await supabase
          .from("client_bots")
          .select("connection_status, connection_qr, updated_at")
          .eq("slug", tenantSlug)
          .maybeSingle();

        if (error) {
          console.warn("[Conexiones] Error al consultar estado inicial:", error);
          if (montado) setErrorSupabase(error.message);
        } else if (data && montado) {
          setStatus(data.connection_status || "disconnected");
          setQrCode(data.connection_qr || null);
          setUltimoCambio(data.updated_at ? new Date(data.updated_at) : new Date());
          setErrorSupabase(null);
        }
      } catch (err: any) {
        console.error("[Conexiones] Excepción cargando estado inicial:", err);
        if (montado) setErrorSupabase(err?.message || "Error al conectar con la base de datos.");
      } finally {
        if (montado) setCargando(false);
      }
    }

    obtenerEstadoInicial();

    // 2. Suscripción en Tiempo Real con Supabase Realtime
    const channelName = `realtime:client_bots:${tenantSlug}`;
    const canal = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "client_bots",
          filter: `slug=eq.${tenantSlug}`,
        },
        (payload) => {
          const nuevo = payload.new as ClientBotState;
          if (nuevo && montado) {
            console.log("[Conexiones Realtime] Actualización recibida:", nuevo);
            setStatus(nuevo.connection_status || "disconnected");
            setQrCode(nuevo.connection_qr || null);
            setUltimoCambio(new Date());
          }
        },
      )
      .subscribe((estadoSub, errSub) => {
        if (errSub) {
          console.error("[Conexiones Realtime] Error en suscripción:", errSub);
        }
      });

    return () => {
      montado = false;
      supabase.removeChannel(canal);
    };
  }, [tenantSlug]);

  return (
    <div className={`rounded-2xl border border-white/10 bg-zinc-900/60 p-6 backdrop-blur-xl shadow-2xl ${className}`}>
      {/* Encabezado */}
      <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <IconWhatsApp size={22} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-100">
              Conexión de WhatsApp
            </h3>
            <p className="text-xs text-zinc-400">
              Vinculación directa en tiempo real para el bot <span className="font-mono text-zinc-300">@{tenantSlug}</span>
            </p>
          </div>
        </div>

        {/* Badge de Estado */}
        <div>
          {status === "open" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              En línea y activo
            </span>
          )}
          {status === "qr_ready" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400 border border-amber-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping" />
              Esperando escaneo QR
            </span>
          )}
          {status === "connecting" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400 border border-blue-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              Conectando…
            </span>
          )}
          {status === "disconnected" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-400 border border-zinc-700">
              <span className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
              Desconectado
            </span>
          )}
        </div>
      </div>

      {/* Alerta de Error */}
      {errorSupabase && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-red-500/10 p-3 text-xs text-red-400 border border-red-500/20">
          <IconWarning size={16} />
          <span>{errorSupabase}</span>
        </div>
      )}

      {/* Cuerpo principal según estado */}
      {cargando ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent mb-3" />
          <p className="text-sm text-zinc-400">Sincronizando estado con Supabase Realtime…</p>
        </div>
      ) : status === "open" ? (
        /* ESTADO ACTIVO: ÉXITO */
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 mb-4 shadow-lg shadow-emerald-500/10">
            <svg
              className="h-8 w-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h4 className="text-lg font-bold text-zinc-100">
            ¡WhatsApp Vinculado y Activo!
          </h4>
          <p className="mt-1 max-w-md text-sm text-zinc-400">
            El bot está escuchando y procesando mensajes entrantes en tiempo real con Gemini 1.5 Flash.
          </p>
          <div className="mt-6 flex items-center gap-2 text-xs text-zinc-500">
            <span>Sincronizado vía Supabase Realtime</span>
            {ultimoCambio && <span>• Actualizado hace un momento</span>}
          </div>
        </div>
      ) : status === "qr_ready" && qrCode ? (
        /* ESTADO QR_READY: RENDERIZAR QR CON QRCODE.REACT */
        <div className="flex flex-col items-center justify-center py-4 text-center">
          <div className="mb-4">
            <h4 className="text-base font-semibold text-zinc-200">
              Escanea el código QR con tu WhatsApp
            </h4>
            <p className="mt-1 text-xs text-zinc-400 max-w-sm">
              Abre WhatsApp en tu teléfono → Configuración / Menú → Dispositivos vinculados → Vincular un dispositivo.
            </p>
          </div>

          <div className="relative p-4 bg-white rounded-2xl shadow-2xl shadow-emerald-500/5 border border-white/20">
            <QRCodeSVG
              value={qrCode}
              size={240}
              level="M"
              includeMargin={false}
            />
          </div>

          <p className="mt-4 text-xs text-zinc-400 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            Actualización instantánea: el código se refresca automáticamente.
          </p>
        </div>
      ) : (
        /* ESTADO CONECTANDO / ESPERANDO */
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-600 border-t-zinc-200 mb-4" />
          <h4 className="text-sm font-medium text-zinc-200">
            {status === "connecting" ? "Iniciando servicio de WhatsApp…" : "Esperando generación de nuevo QR…"}
          </h4>
          <p className="mt-1 text-xs text-zinc-400 max-w-xs">
            El backend está arrancando el socket de Baileys. El código QR aparecerá aquí en cuanto esté disponible.
          </p>
        </div>
      )}
    </div>
  );
}
