import { Phone, Clock } from "lucide-react";

/**
 * Tarjeta de conexión para el canal "llamadas". Misma forma visual que
 * WhatsAppCard (mismo "hueso") para que el dashboard se sienta consistente
 * sin importar el tipo de bot del cliente. Todavía no hay backend de
 * telefonía — cuando exista, esto se conecta igual que WhatsAppCard: un
 * endpoint de estado + acción de conectar.
 */
export function CallBotCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-card/60 p-6 backdrop-blur-xl">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-sky-400/20 blur-3xl" />
      <div className="flex items-center justify-between">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300">
          <Phone className="h-6 w-6" />
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          Próximamente
        </span>
      </div>

      <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
        Línea telefónica
      </h3>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" /> El bot de llamadas para este negocio aún no está
        conectado. Escríbenos a Stage AI Labs para activarlo.
      </p>
    </div>
  );
}
