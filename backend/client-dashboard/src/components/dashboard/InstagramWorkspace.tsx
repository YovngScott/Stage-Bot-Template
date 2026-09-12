import { useEffect, useState } from "react";
import { Instagram, Plus, Save, Trash2 } from "lucide-react";
import { adminFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Rule = { id: string; enabled: boolean; keywords: string[]; match: "exact" | "word"; reply: string };
type Connection = { username: string; enabled: boolean };
type Page = { id: string; name: string; instagram_business_account?: { id: string } };
type Facebook = {
  init: (options: object) => void;
  login: (callback: (response: { authResponse?: { accessToken: string } }) => void, options: object) => void;
  api: (path: string, params: object, callback: (response: { data?: Page[]; error?: unknown }) => void) => void;
};
declare global { interface Window { FB?: Facebook } }
async function request(path: string, options?: RequestInit) {
  const response = await adminFetch(`/instagram${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "No pudimos completar la solicitud. Inténtalo de nuevo.");
  return body;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export function InstagramWorkspace() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sdkReady, setSdkReady] = useState(false);
  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState("");
  const [token, setToken] = useState("");
  const [dirty, setDirty] = useState(false);
  async function load() {
    setLoading(true); setError("");
    try {
      const [state, automation] = await Promise.all([request("/connection"), request("/rules")]);
      setConnection(state.connection); setLegacy(state.legacyConnected); setRules(automation.rules); setDirty(false);
      if (state.facebookReady && state.appId) {
        const initialize = () => { window.FB?.init({ appId: state.appId, version: "v26.0", cookie: false }); setSdkReady(Boolean(window.FB)); };
        if (window.FB) initialize();
        else {
          const script = document.createElement("script"); script.src = "https://connect.facebook.net/es_LA/sdk.js"; script.async = true;
          script.onload = initialize; script.onerror = () => setError("Facebook no pudo cargar. Recarga la página para volver a intentar.");
          document.head.appendChild(script);
        }
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos cargar Instagram."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function act(work: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos guardar los cambios."); }
    finally { setBusy(false); }
  }
  function login() {
    setError("");
    window.FB?.login(response => {
      if (!response.authResponse) { setNotice("La conexión se canceló. Puedes volver a intentarlo."); return; }
      const accessToken = response.authResponse.accessToken;
      window.FB?.api("/me/accounts", { fields: "id,name,instagram_business_account", limit: 100, access_token: accessToken }, result => {
        const available = result.data?.filter(page => page.instagram_business_account) ?? [];
        if (result.error || !available.length) { setError("No encontramos una página autorizada con Instagram profesional. Revisa los permisos en Facebook."); return; }
        setToken(accessToken); setPages(available); setPageId(available[0].id);
      });
    }, { scope: "pages_show_list,pages_read_engagement,pages_manage_metadata,instagram_basic,instagram_manage_messages,instagram_manage_comments", auth_type: "rerequest" });
  }
  function update(id: string, patch: Partial<Rule>) { setRules(current => current.map(rule => rule.id === id ? { ...rule, ...patch } : rule)); setDirty(true); setNotice(""); }
  return <section aria-labelledby="instagram-title" className="min-w-0 rounded-xl border border-border bg-card p-5 sm:p-8">
    <header className="flex flex-wrap items-start justify-between gap-6">
      <div className="max-w-2xl min-w-0">
        <h2 id="instagram-title" className="flex items-center gap-3 text-2xl font-semibold text-foreground"><Instagram aria-hidden="true" className="h-6 w-6 text-primary" />Instagram</h2>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">Conecta tu cuenta profesional y atiende tus mensajes con las instrucciones de tu negocio.</p>
        <p className="mt-3 text-sm text-foreground">{loading ? "Consultando tu cuenta…" : connection ? `@${connection.username} · ${connection.enabled ? "Respuestas activadas" : "En pausa"}` : legacy ? "Cuenta de prueba conectada" : "Sin cuenta conectada"}</p>
      </div>
      {connection ? <Button className="min-h-11" variant="outline" disabled={busy} onClick={() => void act(async () => { await request("/connection", json("PATCH", { enabled: !connection.enabled })); setConnection({ ...connection, enabled: !connection.enabled }); })}>{connection.enabled ? "Pausar respuestas" : "Activar respuestas"}</Button>
        : <Button className="min-h-11" disabled={loading || busy || !sdkReady} onClick={login}>Conectar con Facebook</Button>}
    </header>
    {!loading && !sdkReady && !connection && <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Estamos terminando de habilitar la conexión con Facebook. Puedes preparar tus respuestas mientras tanto.</p>}
    {pages.length > 0 && <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void act(async () => { const connected = await request("/connection", json("POST", { accessToken: token, pageId })); setConnection({ username: connected.username || "Instagram", enabled: true }); setPages([]); setToken(""); setNotice("Instagram conectado. Las respuestas están activadas."); }); }}>
      <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm">Página de tu negocio<select className="min-h-11 rounded-md border border-input bg-background px-3 text-base" value={pageId} onChange={event => setPageId(event.target.value)}>{pages.map(page => <option key={page.id} value={page.id}>{page.name}</option>)}</select></label>
      <Button className="min-h-11" disabled={busy} type="submit">Conectar esta cuenta</Button>
    </form>}
    <div className="mt-8 border-t border-border pt-8">
      <div className="flex flex-wrap items-center justify-between gap-4"><h3 className="text-lg font-semibold">Respuestas por palabras clave</h3><Button variant="outline" className="min-h-11" disabled={loading || busy || rules.length >= 50 || Boolean(error && !dirty)} onClick={() => { setRules([...rules, { id: crypto.randomUUID(), enabled: true, keywords: [], match: "word", reply: "" }]); setDirty(true); }}><Plus className="mr-2 h-4 w-4" aria-hidden="true" />Crear respuesta</Button></div>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Cuando una persona escriba una de estas palabras, recibirá la respuesta que prepares. Si coinciden varias reglas, se usa la primera.</p>
      {!loading && rules.length === 0 && <p className="py-8 text-base text-muted-foreground">Todavía no tienes respuestas por palabras clave. Crea la primera para atender una consulta frecuente.</p>}
      <form className="mt-6 space-y-6" onSubmit={event => { event.preventDefault(); void act(async () => { await request("/rules", json("PUT", { rules })); setDirty(false); setNotice("Tus respuestas se guardaron."); }); }}>
        {rules.map((rule, index) => <fieldset key={rule.id} className="min-w-0 space-y-4 border-b border-border pb-6" disabled={busy}>
          <legend className="mb-3 text-base font-medium">Respuesta {index + 1}</legend>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm"><span>Palabras clave, separadas por comas</span><Input className="min-h-11 text-base" required maxLength={2400} value={rule.keywords.join(",")} onChange={event => update(rule.id, { keywords: event.target.value.split(",") })} placeholder="información, catálogo" /></label>
            <label className="flex flex-col gap-2 text-sm">Cuándo responder<select className="min-h-11 rounded-md border border-input bg-background px-3 text-base" value={rule.match} onChange={event => update(rule.id, { match: event.target.value as Rule["match"] })}><option value="word">El mensaje incluye la palabra</option><option value="exact">El mensaje coincide exactamente</option></select></label>
          </div>
          <label className="block space-y-2 text-sm"><span>Respuesta que recibirá la persona</span><Textarea className="min-h-28 text-base" required maxLength={1000} value={rule.reply} onChange={event => update(rule.id, { reply: event.target.value })} /></label>
          <div className="flex flex-wrap items-center justify-between gap-4"><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5 accent-primary" checked={rule.enabled} onChange={event => update(rule.id, { enabled: event.target.checked })} />Activada</label><Button type="button" variant="ghost" className="min-h-11" onClick={() => { setRules(rules.filter(item => item.id !== rule.id)); setDirty(true); }}><Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />Quitar</Button></div>
        </fieldset>)}
        <Button type="submit" className="min-h-11" disabled={loading || busy || !dirty}><Save aria-hidden="true" className="mr-2 h-4 w-4" />{busy ? "Guardando…" : "Guardar respuestas"}</Button>
      </form>
    </div>
    {error && <div role="alert" className="mt-5 text-sm text-destructive"><p>{error}</p>{!dirty && <Button variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>Volver a cargar</Button>}</div>}
    <p role="status" className="mt-4 text-sm text-foreground">{notice}</p>
  </section>;
}
