import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { reiniciarTenantId } from "@/lib/tenant";

export type AuthState = {
  /** null mientras se resuelve la sesión inicial. */
  authenticated: boolean | null;
  email: string | null;
};

/**
 * Estado de sesión del dashboard (Supabase Auth). El aislamiento por cliente
 * lo garantiza RLS + tenant_admins en la base; aquí solo controlamos si hay
 * una sesión válida para mostrar el login o el panel.
 */
export function useAuth(): AuthState {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      setAuthenticated(Boolean(data.session));
      setEmail(data.session?.user?.email ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setAuthenticated(Boolean(session));
      setEmail(session?.user?.email ?? null);
      if (!session) reiniciarTenantId();
    });
    return () => {
      activo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { authenticated, email };
}
