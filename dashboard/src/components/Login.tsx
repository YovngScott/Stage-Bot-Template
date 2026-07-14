import { useState } from "react";
import { login } from "../lib/api";
import { Logo } from "./Logo";
import { IconWarning } from "./Icons";
import { negocio } from "../lib/negocio";

interface Props {
  onLogin: () => void;
}

/** Pantalla de acceso: Supabase Auth (correo/contraseña) para el dashboard. */
export function Login({ onLogin }: Props) {
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
      onLogin();
    } catch (e: any) {
      setError(e?.message ?? "No se pudo iniciar sesión.");
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-4">
      <div className="card w-full p-6">
        <div className="mb-4 flex items-center gap-3">
          <Logo size={36} />
          <h1 className="text-lg font-semibold">{negocio.nombre}</h1>
        </div>
        <p className="mb-5 text-sm" style={{ color: "var(--text-secondary)" }}>
          Ingresa con tu correo y contraseña para continuar.
        </p>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Correo"
            autoFocus
            autoComplete="username"
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: "var(--baseline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Contraseña"
            autoComplete="current-password"
            className="w-full rounded-md border px-3 py-2 text-sm"
            style={{ borderColor: "var(--baseline)", background: "var(--surface-1)", color: "var(--text-primary)" }}
            required
          />
          <button
            type="submit"
            disabled={cargando}
            className="w-full rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--series-1)" }}
          >
            {cargando ? "Entrando…" : "Entrar"}
          </button>
        </form>
        {error && (
          <p className="mt-3 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "#d03b3b" }}>
            <IconWarning /> {error}
          </p>
        )}
      </div>
    </div>
  );
}
