import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileText, Inbox, Loader2, MailPlus, RefreshCw, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { adminFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CardShell, ChartSkeleton } from "@/components/dashboard/CardShell";

export const Route = createFileRoute("/_app/seguros")({
  head: () => ({ meta: [{ title: "Automatización de seguros · Domínguez" }] }),
  component: InsuranceAutomationPage,
});

type Account = { id: string; email: string; label: string; active: boolean; last_checked_at: string | null; last_error: string | null };
type Review = {
  id: string; remitente: string | null; asunto: string | null; recibido_en: string | null;
  caso_id: string | null;
  chasis_detectado: string | null; placa_detectada: string | null; aseguradora: string | null;
  confianza: number | null; estado: string; motivo_revision: string | null; resumen: string | null;
  comparacion: any;
};

function dateTime(value?: string | null) {
  return value ? new Intl.DateTimeFormat("es-DO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Nunca";
}

async function api(path: string, init?: RequestInit) {
  const response = await adminFetch(`/insurance${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Error ${response.status}`);
  return body;
}

function InsuranceAutomationPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("Correo de seguros");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [accountBody, reviewBody] = await Promise.all([api("/accounts"), api("/reviews?status=revision")]);
      setAccounts(accountBody.data ?? []);
      setReviews(reviewBody.data ?? []);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo cargar el módulo."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy("connect"); setError(null);
    try {
      const body = await api("/accounts/auth-url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, label }) });
      window.open(body.url, "stage-insurance-oauth", "width=620,height=760");
      setTimeout(() => void load(), 3500);
    } catch (err) { setError(err instanceof Error ? err.message : "No se pudo conectar Gmail."); }
    finally { setBusy(null); }
  }

  async function poll() {
    setBusy("poll"); setError(null);
    try { await api("/poll", { method: "POST" }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo revisar Gmail."); }
    finally { setBusy(null); }
  }

  async function openReview(id: string) {
    setBusy(`open:${id}`); setError(null);
    try { setSelected((await api(`/reviews/${id}`)).data); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo abrir la revisión."); }
    finally { setBusy(null); }
  }

  async function resolve(id: string, action: "approve" | "reject") {
    const verb = action === "approve" ? "aprobar y guardar el PDF en el caso" : "rechazar esta revisión";
    if (!confirm(`¿Seguro que deseas ${verb}?`)) return;
    setBusy(`${action}:${id}`); setError(null);
    try { await api(`/reviews/${id}/${action}`, { method: "POST" }); setSelected(null); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "No se pudo resolver la revisión."); }
    finally { setBusy(null); }
  }

  const withDifferences = reviews.filter((r) => r.comparacion?.hasDifferences).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary">Domínguez Auto Pintura</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Automatización de seguros</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Lee únicamente remitentes autorizados, compara contra la última cotización y espera tu aprobación antes de guardar cualquier PDF.</p>
        </div>
        <Button onClick={poll} disabled={busy === "poll"} variant="outline">
          {busy === "poll" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Revisar ahora
        </Button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Metric icon={Inbox} label="Pendientes" value={reviews.length} />
        <Metric icon={AlertTriangle} label="Con diferencias" value={withDifferences} tone="amber" />
        <Metric icon={ShieldCheck} label="Cuentas conectadas" value={accounts.length} tone="green" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.5fr]">
        <div className="space-y-6">
          <CardShell title="Cuentas que lee el bot">
            <form onSubmit={connect} className="space-y-3">
              <div className="space-y-1.5"><Label>Etiqueta</Label><Input value={label} onChange={(e) => setLabel(e.target.value)} /></div>
              <div className="space-y-1.5"><Label>Cuenta Gmail o Google Workspace</Label><Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seguros@dominguezapintura.com" /></div>
              <Button className="w-full ai-gradient-bg text-white" disabled={busy === "connect"}>
                {busy === "connect" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailPlus className="mr-2 h-4 w-4" />}Conectar cuenta
              </Button>
            </form>
            <div className="mt-5 space-y-2 border-t border-white/5 pt-4">
              {accounts.length === 0 ? <p className="text-sm text-muted-foreground">Aún no hay cuentas conectadas.</p> : accounts.map((account) => (
                <div key={account.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{account.label}</p><p className="truncate text-xs text-muted-foreground">{account.email}</p></div><button aria-label="Eliminar cuenta" onClick={async () => { if (confirm(`¿Desconectar ${account.email}?`)) { await api(`/accounts/${account.id}`, { method: "DELETE" }); await load(); } }} className="p-1.5 text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button></div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Última revisión: {dateTime(account.last_checked_at)}</p>
                  {account.last_error && <p className="mt-1 text-xs text-rose-300">{account.last_error}</p>}
                </div>
              ))}
            </div>
          </CardShell>
          <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/[0.06] p-4 text-xs leading-5 text-emerald-100/80"><ShieldCheck className="mb-2 h-5 w-5 text-emerald-300" />El bot tiene permiso de solo lectura. Nunca responde correos. Los PDF permanecen privados y pendientes hasta que pulses Aprobar.</div>
        </div>

        <CardShell title="Revisiones pendientes">
          {loading ? <ChartSkeleton /> : reviews.length === 0 ? <div className="py-14 text-center"><CheckCircle2 className="mx-auto h-9 w-9 text-emerald-400" /><p className="mt-3 text-sm font-medium">Todo revisado</p><p className="mt-1 text-xs text-muted-foreground">No hay correos de seguros esperando tu decisión.</p></div> : (
            <div className="space-y-3">
              {reviews.map((review) => (
                <button key={review.id} onClick={() => openReview(review.id)} className="w-full rounded-xl border border-white/5 bg-white/[0.02] p-4 text-left transition hover:border-primary/30 hover:bg-white/[0.035]">
                  <div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{review.aseguradora || review.remitente || "Seguro"}</p><Status review={review} /></div><p className="mt-1 truncate text-xs text-muted-foreground">{review.asunto || "(sin asunto)"}</p></div><span className="shrink-0 text-[11px] text-muted-foreground">{dateTime(review.recibido_en)}</span></div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3"><span>Placa: <b className="text-foreground">{review.placa_detectada || "—"}</b></span><span>Chasis: <b className="text-foreground">{review.chasis_detectado || "—"}</b></span><span>Confianza: <b className="text-foreground">{Math.round(Number(review.confianza || 0) * 100)}%</b></span></div>
                </button>
              ))}
            </div>
          )}
        </CardShell>
      </div>

      {selected && <ReviewModal review={selected} busy={busy} onClose={() => setSelected(null)} onResolve={resolve} />}
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone = "blue" }: any) {
  const color = tone === "amber" ? "text-amber-300 bg-amber-500/10" : tone === "green" ? "text-emerald-300 bg-emerald-500/10" : "text-primary bg-primary/10";
  return <div className="rounded-2xl border border-white/5 bg-card/60 p-5"><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${color}`}><Icon className="h-5 w-5" /></div><p className="mt-4 text-2xl font-semibold">{value}</p><p className="text-xs text-muted-foreground">{label}</p></div>;
}

function Status({ review }: { review: Review }) {
  if (!review.caso_id) return <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-medium text-rose-300">Sin caso</span>;
  if (review.comparacion?.hasDifferences) return <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">Con diferencias</span>;
  return <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">Coincide</span>;
}

function ReviewModal({ review, busy, onClose, onResolve }: any) {
  const comparison = review.comparacion;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}><div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-white/10 bg-[#0b1118] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-wider text-primary">Revisión del seguro</p><h2 className="mt-1 text-xl font-semibold">{review.asunto || "(sin asunto)"}</h2><p className="mt-1 text-xs text-muted-foreground">{review.remitente} · {dateTime(review.recibido_en)}</p></div><button onClick={onClose} className="p-2 text-muted-foreground"><XCircle className="h-5 w-5" /></button></div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3"><Info label="Placa" value={review.placa_detectada} /><Info label="Chasis" value={review.chasis_detectado} /><Info label="Confianza" value={`${Math.round(Number(review.confianza || 0) * 100)}%`} /></div>
    {review.resumen && <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm text-muted-foreground">{review.resumen}</div>}
    {comparison && <div className="mt-5 space-y-3"><h3 className="text-sm font-semibold">Comparación contra la última cotización</h3>{comparison.changed?.map((item: any, index: number) => <Difference key={`c${index}`} tone="amber" title={item.ours.description} detail={`Taller RD$${item.ours.subtotal.toLocaleString()} → Seguro RD$${item.theirs.subtotal.toLocaleString()} · ${item.differences.join(", ")}`} />)}{comparison.removed?.map((item: any, index: number) => <Difference key={`r${index}`} tone="rose" title={`Eliminada: ${item.description}`} detail={`Cotizada por el taller en RD$${item.subtotal.toLocaleString()}`} />)}{comparison.added?.map((item: any, index: number) => <Difference key={`a${index}`} tone="blue" title={`Agregada: ${item.description}`} detail={`Seguro RD$${item.subtotal.toLocaleString()}`} />)}{!comparison.hasDifferences && <Difference tone="green" title="Todas las líneas coinciden" detail="Aun así, el PDF solo se guardará cuando lo apruebes." />}</div>}
    <div className="mt-5 flex flex-wrap gap-2">{review.archivos?.map((file: any) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs hover:border-primary/40"><FileText className="h-4 w-4" />{file.nombre_archivo}</a>)}</div>
    <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-white/5 pt-5">{comparison?.hasDifferences && <p className="mr-auto text-xs text-amber-300">Con diferencias, el bot no guarda: corrige el caso manualmente y rechaza esta revisión.</p>}<Button variant="outline" disabled={Boolean(busy)} onClick={() => onResolve(review.id, "reject")}>Rechazar</Button><Button disabled={Boolean(busy) || comparison?.hasDifferences || !review.archivos?.length} onClick={() => onResolve(review.id, "approve")} className="ai-gradient-bg text-white">{busy === `approve:${review.id}` && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Aprobar y guardar PDF</Button></div>
  </div></div>;
}

function Info({ label, value }: any) { return <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 truncate text-sm font-medium">{value || "—"}</p></div>; }
function Difference({ tone, title, detail }: any) { const color = tone === "rose" ? "border-rose-500/20 bg-rose-500/[0.06]" : tone === "amber" ? "border-amber-500/20 bg-amber-500/[0.06]" : tone === "green" ? "border-emerald-500/20 bg-emerald-500/[0.06]" : "border-primary/20 bg-primary/[0.06]"; return <div className={`rounded-xl border p-3 ${color}`}><p className="text-sm font-medium">{title}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>; }
