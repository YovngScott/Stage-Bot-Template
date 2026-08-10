import { Outlet, createFileRoute } from "@tanstack/react-router";
import { AppSidebar } from "@/components/dashboard/Sidebar";
import { AppHeader } from "@/components/dashboard/Header";
import { EnvErrorBanner } from "@/components/dashboard/EnvErrorBanner";
import { Login } from "@/components/auth/Login";
import { Button } from "@/components/ui/button";
import { useTenantData } from "@/hooks/useTenantData";
import { useAuth } from "@/hooks/useAuth";
import { logout } from "@/lib/api";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { authenticated, email } = useAuth();
  const { data, loading, sinAcceso, env } = useTenantData();

  // Resolviendo la sesión inicial: evita el parpadeo login → panel.
  if (authenticated === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Comprobando sesión…
      </div>
    );
  }

  // Sin sesión → pantalla de acceso (sin barra lateral ni panel).
  if (!authenticated) {
    return <Login businessName={data?.tenant.businessName} />;
  }

  // Sesión válida pero la cuenta logueada NO pertenece a este cliente: cada
  // enlace exclusivo debe entrarse con las cuentas de ESE negocio. En vez de
  // un mensaje muerto (o mostrar datos ajenos — que RLS ya impide), ofrecemos
  // cambiar de cuenta: cerrar la sesión ajena y entrar con la correcta.
  if (sinAcceso) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-primary/20 blur-[120px]" />
        </div>
        <div className="relative w-full max-w-sm rounded-2xl border border-white/5 bg-card/60 p-6 text-center backdrop-blur-xl">
          <h1 className="text-lg font-semibold text-foreground">Esta cuenta no es de este negocio</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            La sesión actual ({email || "sin correo"}) no tiene acceso a este panel. Este enlace es
            exclusivo del negocio: inicia sesión con el correo de este cliente.
          </p>
          <Button
            onClick={() => void logout()}
            className="mt-5 w-full ai-gradient-bg text-white hover:opacity-90"
          >
            Iniciar sesión con otra cuenta
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full bg-background text-foreground">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute right-0 top-1/3 h-96 w-96 rounded-full bg-accent/10 blur-[120px]" />
      </div>

      <AppSidebar
        tenant={data?.tenant ?? null}
        loading={loading}
        email={email}
        onSignOut={() => void logout()}
      />

      <div className="relative flex min-w-0 flex-1 flex-col">
        <AppHeader tenant={data?.tenant ?? null} loading={loading} />
        <EnvErrorBanner env={env} />
        <main className="flex-1 px-6 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
