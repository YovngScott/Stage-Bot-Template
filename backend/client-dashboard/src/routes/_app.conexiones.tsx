import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Trash2, UserPlus, AlertCircle, Loader2 } from "lucide-react";
import { useTenantData } from "@/hooks/useTenantData";
import { adminFetch, getApiUrl } from "@/lib/api";
import { CardShell } from "@/components/dashboard/CardShell";
import { WhatsAppCard } from "@/components/dashboard/WhatsAppCard";
import { CallBotCard } from "@/components/dashboard/CallBotCard";
import { AssistantBotCard } from "@/components/dashboard/AssistantBotCard";
import { GoogleCalendarCard } from "@/components/dashboard/GoogleCalendarCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/conexiones")({
  head: () => ({
    meta: [
      { title: "Conexiones · Stage AI Labs" },
      {
        name: "description",
        content: "Gestiona las integraciones de WhatsApp, Google Calendar y escalamientos.",
      },
    ],
  }),
  component: ConexionesPage,
});

function ConexionesPage() {
  const { data, loading, recargar } = useTenantData();
  const apiConfigurada = Boolean(getApiUrl());
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const empleados = data?.employees ?? [];
  const canal = data?.tenant.canal ?? "mensajes";

  async function agregar(e: React.FormEvent) {
    e.preventDefault();
    if (!name || !phone) return;
    if (!apiConfigurada) {
      setError("Falta configurar VITE_API_URL para administrar empleados.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const res = await adminFetch("/empleados", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nombre: name, telefono: phone }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Error ${res.status}`);
      setName("");
      setPhone("");
      await recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar el empleado.");
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(id: string, nombre: string) {
    if (!apiConfigurada) return;
    if (!confirm(`¿Quitar a ${nombre} de las alertas?`)) return;
    setError(null);
    try {
      const res = await adminFetch(`/empleados/${id}`, { method: "DELETE" });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({})))?.error ?? `Error ${res.status}`);
      await recargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el empleado.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {canal === "asistente" && <AssistantBotCard />}
        {canal === "llamadas" && <CallBotCard />}
        <WhatsAppCard />
        <GoogleCalendarCard />

        {/* Empleados & alertas */}
        <div className="rounded-2xl border border-white/5 bg-card/60 p-6 backdrop-blur-xl">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <UserPlus className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-base font-semibold tracking-tight text-foreground">
            Empleados y alertas
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Reciben un WhatsApp cuando un chat se escala a humano o cuando el stock queda bajo.
          </p>

          <form className="mt-5 space-y-3" onSubmit={agregar}>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nombre</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Jorge Domínguez"
                className="bg-white/[0.03] border-white/10"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Teléfono</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="18110000000"
                className="bg-white/[0.03] border-white/10"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={guardando}
              className="w-full ai-gradient-bg text-white hover:opacity-90"
            >
              {guardando ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 h-4 w-4" />
              )}
              Agregar
            </Button>
          </form>

          {error && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-rose-300" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" /> {error}
            </p>
          )}
        </div>
      </div>

      <CardShell title="Empleados que reciben alertas">
        {loading && empleados.length === 0 ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : empleados.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay empleados configurados: no se enviará ninguna alerta.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {empleados.map((e) => (
              <li
                key={e.id}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full ai-gradient-bg text-xs font-semibold text-white">
                    {e.name[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{e.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">{e.phone}</p>
                  </div>
                </div>
                <button
                  onClick={() => eliminar(e.id, e.name)}
                  className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-destructive"
                  aria-label="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardShell>
    </div>
  );
}
