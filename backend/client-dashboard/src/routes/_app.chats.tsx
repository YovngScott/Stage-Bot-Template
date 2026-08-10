import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CalendarCheck, Clock, MessageSquare } from "lucide-react";
import { useTenantData } from "@/hooks/useTenantData";
import { adminFetch, getApiUrl } from "@/lib/api";
import { CardShell } from "@/components/dashboard/CardShell";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app/chats")({
  head: () => ({
    meta: [
      { title: "Estados de chats · Stage AI Labs" },
      {
        name: "description",
        content: "Chats pausados para atención humana y clientes con cita agendada.",
      },
    ],
  }),
  component: ChatsPage,
});

function ChatsPage() {
  const { data, loading, recargar } = useTenantData();
  const [atendiendo, setAtendiendo] = useState<string | null>(null);

  async function atender(clienteId: string) {
    if (!getApiUrl()) {
      alert("Falta configurar VITE_API_URL para marcar el chat como atendido.");
      return;
    }
    setAtendiendo(clienteId);
    try {
      const res = await adminFetch(`/whatsapp/clientes/${clienteId}/atendido`, { method: "POST" });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({})))?.error ?? `Error ${res.status}`);
      await recargar();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo marcar como atendido.");
    } finally {
      setAtendiendo(null);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <CardShell
        title="Solicitudes de atención humana"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">
            {loading || !data ? "…" : data.pendingChats.length} pendientes
          </span>
        }
      >
        {loading || !data ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <ul className="space-y-3">
            {data.pendingChats.map((c) => (
              <li
                key={c.id}
                className="group flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/10"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-300">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{c.customer}</p>
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {c.waitingMin}m
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">{c.phone}</p>
                  <p className="mt-1 truncate text-xs text-foreground/70">"{c.lastMessage}"</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  disabled={atendiendo === c.id}
                  onClick={() => atender(c.id)}
                >
                  {atendiendo === c.id ? "…" : "Atender"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardShell>

      <CardShell
        title="Clientes con cita agendada"
        action={
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            {loading || !data ? "…" : data.bookedChats.length} agendadas
          </span>
        }
      >
        {loading || !data ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <ul className="space-y-3">
            {data.bookedChats.map((b) => (
              <li
                key={b.id}
                className="group flex items-start gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-white/10"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
                  <CalendarCheck className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{b.customer}</p>
                    <span className="shrink-0 rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-foreground/80">
                      {b.appointmentAt}
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground">{b.phone}</p>
                  <p className="mt-1 truncate text-xs text-foreground/70">{b.service}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardShell>
    </div>
  );
}
