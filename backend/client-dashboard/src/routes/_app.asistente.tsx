import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { adminFetch, getApiUrl } from "@/lib/api";
import { AssistantBotCard } from "@/components/dashboard/AssistantBotCard";
import { CardShell } from "@/components/dashboard/CardShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app/asistente")({
  head: () => ({
    meta: [
      { title: "Asistente · Stage AI Labs" },
      {
        name: "description",
        content: "Triaje de correo: qué resolvió el asistente y qué espera tu criterio.",
      },
    ],
  }),
  component: AsistentePage,
});

interface Metricas {
  triadosHoy: number;
  descartadosAutomaticos: number;
  enviadosSolos: number;
  borradoresCreados: number;
  pendientesRevision: number;
  resueltosPorTitular: number;
  confianzaPromedio: number | null;
}

interface CorreoTriado {
  id: string;
  remitente: string;
  asunto: string;
  recibido_en: string;
  categoria: string | null;
  prioridad: string | null;
  confianza: number | null;
  justificacion: string | null;
  resultado: "enviado" | "auto" | "revision" | "omitido" | "error";
  motivo_descarte: string | null;
  borrador_id: string | null;
  alerta_enviada: boolean;
  /** Fecha en que el titular lo resolvió en su buzón; null = sigue esperando. */
  resuelto_en: string | null;
  resolucion: string | null;
}

const ETIQUETA: Record<CorreoTriado["resultado"], { texto: string; clase: string }> = {
  enviado: {
    texto: "Respondido y enviado",
    clase: "border-emerald-400/25 bg-emerald-500/10 text-emerald-300",
  },
  auto: { texto: "Borrador listo", clase: "border-sky-400/25 bg-sky-500/10 text-sky-300" },
  revision: {
    texto: "Espera tu revisión",
    clase: "border-amber-400/25 bg-amber-500/10 text-amber-300",
  },
  omitido: { texto: "Descartado", clase: "border-white/10 bg-white/5 text-muted-foreground" },
  error: {
    texto: "No se pudo analizar",
    clase: "border-destructive/25 bg-destructive/10 text-destructive",
  },
};

function fechaLegible(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

const REFRESCO_MS = 30_000;

function AsistentePage() {
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [pendientes, setPendientes] = useState<CorreoTriado[]>([]);
  const [recientes, setRecientes] = useState<CorreoTriado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [triando, setTriando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!getApiUrl()) {
      setError("Falta configurar la dirección del backend de este cliente.");
      setCargando(false);
      return;
    }
    try {
      const [m, r, p] = await Promise.all([
        adminFetch("/asistente/metricas"),
        adminFetch("/asistente/correos?limite=15"),
        adminFetch("/asistente/correos?limite=25&pendientes=1"),
      ]);
      if (!m.ok || !r.ok || !p.ok) throw new Error("El backend respondió con error.");
      const [dm, dr, dp] = await Promise.all([m.json(), r.json(), p.json()]);
      setMetricas(dm as Metricas);
      setRecientes((dr.correos ?? []) as CorreoTriado[]);
      setPendientes((dp.correos ?? []) as CorreoTriado[]);
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo cargar la actividad del asistente.",
      );
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    const t = setInterval(() => void cargar(), REFRESCO_MS);
    return () => clearInterval(t);
  }, [cargar]);

  async function triarAhora() {
    setTriando(true);
    setAviso(null);
    try {
      const res = await adminFetch("/asistente/triar", { method: "POST" });
      const cuerpo = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(cuerpo?.error ?? `Error ${res.status}`);
      const r = cuerpo.resumen;
      const partes = [
        `${r.revisados} revisados`,
        `${r.enviados} respondidos y enviados`,
        `${r.escaladosRevision} esperando tu revisión`,
      ];
      // Solo se menciona si hubo algo: en la mayoría de las corridas es 0 y
      // nombrarlo siempre sería ruido.
      if (r.reconciliados > 0) {
        partes.push(`${r.reconciliados} que ya resolviste salieron de la lista`);
      }
      setAviso(`Listo: ${partes.join(", ")}.`);
      await cargar();
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se pudo ejecutar el triaje.");
    } finally {
      setTriando(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Panel / Asistente
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
          Asistente virtual
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Qué resolvió el asistente en tu bandeja y qué dejó esperando tu criterio.
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
        <AssistantBotCard />

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metrica titulo="Triados hoy" valor={metricas?.triadosHoy} cargando={cargando} />
            <Metrica
              titulo="Respondidos solos"
              valor={metricas?.enviadosSolos}
              detalle="Salieron sin que intervinieras"
              cargando={cargando}
            />
            <Metrica
              titulo="Descartados"
              valor={metricas?.descartadosAutomaticos}
              detalle="Boletines, no-reply, masivo"
              cargando={cargando}
            />
            <Metrica
              titulo="Esperan tu revisión"
              valor={metricas?.pendientesRevision}
              detalle="Con el borrador ya escrito"
              cargando={cargando}
            />
          </div>

          <CardShell
            title="Borradores esperando que los envíes"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => void triarAhora()}
                disabled={triando}
                className="gap-2"
              >
                {triando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                {triando ? "Revisando…" : "Triar ahora"}
              </Button>
            }
          >
            <p className="-mt-1 mb-4 text-xs text-muted-foreground">
              Cada uno tiene la respuesta ya escrita como borrador en tu bandeja: revísala, ajústala
              si hace falta y dale a Enviar. Cuando lo hagas —o si lo descartas— desaparece de aquí
              solo. Los marcados <span className="text-amber-300">Necesita tu criterio</span> son los
              que el asistente no se atrevió a resolver por su cuenta.
            </p>

            {aviso && <p className="mb-3 text-xs text-muted-foreground">{aviso}</p>}

            {error && (
              <p className="flex items-start gap-1.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
              </p>
            )}

            {!error && cargando && <Skeleton className="h-24 w-full" />}

            {!error && !cargando && pendientes.length === 0 && (
              <p className="flex items-center gap-1.5 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> No hay borradores esperando: la bandeja está al día.
              </p>
            )}

            {!error && pendientes.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {pendientes.map((c) => (
                  <article
                    key={c.id}
                    className="rounded-xl border border-white/5 bg-white/[0.02] p-4"
                  >
                    <p className="text-sm font-medium text-foreground">{c.asunto}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{c.remitente}</p>
                    {c.justificacion && (
                      <p className="mt-2 text-xs text-muted-foreground">{c.justificacion}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {c.categoria && (
                        <span className="rounded-full bg-white/5 px-2 py-0.5">{c.categoria}</span>
                      )}
                      <span
                        className={
                          c.resultado === "auto"
                            ? "rounded-full border border-sky-400/25 bg-sky-500/10 px-2 py-0.5 text-sky-300"
                            : "rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-amber-300"
                        }
                      >
                        {c.resultado === "auto" ? "Listo para enviar" : "Necesita tu criterio"}
                      </span>
                      <span>{fechaLegible(c.recibido_en)}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </CardShell>
        </div>

        <div className="lg:col-span-2">
          <CardShell title="Actividad reciente">
            {!error && cargando && <Skeleton className="h-32 w-full" />}
            {!error && !cargando && recientes.length === 0 && (
              <p className="text-sm text-muted-foreground">Todavía no hay correos triados.</p>
            )}
            {recientes.length > 0 && (
              <div className="-mx-5 max-h-[430px] overflow-auto px-5">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-card">
                    <tr className="text-xs text-muted-foreground">
                      <th className="pb-2 pr-3 font-normal">Correo</th>
                      <th className="pb-2 pr-3 font-normal">Categoría</th>
                      <th className="pb-2 pr-3 font-normal">Resultado</th>
                      <th className="pb-2 font-normal">Recibido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recientes.map((c) => {
                      const et = ETIQUETA[c.resultado] ?? ETIQUETA.omitido;
                      return (
                        <tr key={c.id} className="border-t border-white/5">
                          <td className="max-w-[220px] py-2.5 pr-3">
                            <span className="block truncate font-medium text-foreground">
                              {c.asunto}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.remitente}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                            {c.categoria ?? c.motivo_descarte ?? "—"}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span
                              className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${et.clase}`}
                            >
                              {et.texto}
                            </span>
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            {fechaLegible(c.recibido_en)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardShell>
        </div>
      </div>
    </div>
  );
}

function Metrica({
  titulo,
  valor,
  detalle,
  cargando,
}: {
  titulo: string;
  valor: number | undefined;
  detalle?: string;
  cargando: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/5 bg-card/60 p-5 backdrop-blur-xl">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {titulo}
      </p>
      {cargando ? (
        <Skeleton className="mt-3 h-9 w-16" />
      ) : (
        <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{valor ?? 0}</p>
      )}
      {detalle && <p className="mt-2 text-[11px] text-muted-foreground">{detalle}</p>}
    </div>
  );
}
