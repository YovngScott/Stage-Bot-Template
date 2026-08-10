import { useState } from "react";
import { Zap, AlertCircle, Loader2 } from "lucide-react";
import { login } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Pantalla de acceso: Supabase Auth (correo/contraseña) para el dashboard. */
export function Login({ businessName }: { businessName?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    try {
      await login(email, password);
      // onAuthStateChange en useAuth reacciona y monta el panel.
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute right-0 bottom-0 h-96 w-96 rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl ai-gradient-bg glow-primary">
            <Zap className="h-6 w-6 text-white" strokeWidth={2.5} />
          </div>
          <p className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Stage AI Labs
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
            {businessName || "Consola del bot"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ingresa con tu correo y contraseña para continuar.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-2xl border border-white/5 bg-card/60 p-6 backdrop-blur-xl"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs text-muted-foreground">
              Correo
            </Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@negocio.com"
              autoFocus
              autoComplete="username"
              required
              className="bg-white/[0.03] border-white/10"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs text-muted-foreground">
              Contraseña
            </Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
              className="bg-white/[0.03] border-white/10"
            />
          </div>

          {error && (
            <p className="flex items-center gap-1.5 text-sm text-rose-300" role="alert">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={cargando}
            className="w-full ai-gradient-bg text-white hover:opacity-90"
          >
            {cargando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {cargando ? "Entrando…" : "Iniciar sesión"}
          </Button>
        </form>
      </div>
    </div>
  );
}
