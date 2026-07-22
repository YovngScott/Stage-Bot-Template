import { useEffect, useState } from "react";
import { useDashboardData } from "./hooks/useDashboardData";
import { MetricCard } from "./components/MetricCard";
import { ClientesPorDiaChart, ServiciosChart, CategoriasChart } from "./components/charts";
import { PreguntasTable } from "./components/PreguntasTable";
import { CatalogoUpload } from "./components/CatalogoUpload";
import { WhatsAppStatus } from "./components/WhatsAppStatus";
import { GoogleCalendarStatus } from "./components/GoogleCalendarStatus";
import { SolicitudesHumanas } from "./components/SolicitudesHumanas";
import { Empleados } from "./components/Empleados";
import { EstadosChats } from "./components/EstadosChats";
import { OperacionesHoy } from "./components/OperacionesHoy";
import { AsistenteConexionGmail } from "./components/AsistenteConexionGmail";
import { AsistentePanel } from "./components/AsistentePanel";
import { Logo } from "./components/Logo";
import { Login } from "./components/Login";
import { adminFetch, logout, verificarAcceso, type EstadoAcceso } from "./lib/api";
import { supabase } from "./lib/supabase";
import { cargarNegocio, negocioInicial, type Negocio } from "./lib/negocio";
import {
  IconChart,
  IconPlug,
  IconChat,
  IconFolder,
  IconWarning,
  IconDownload,
  IconLogout,
  IconCalendar,
  IconUsers,
  IconPercent,
  IconPanelLeft,
  IconSparkles,
} from "./components/Icons";

type Pestana = "estadisticas" | "conexiones" | "chats" | "archivos" | "asistente";

type Tab = {
  id: Pestana;
  etiqueta: string;
  breadcrumb: string;
  icono: (props: { size?: number }) => JSX.Element;
};

const PESTANAS_VENTA: Tab[] = [
  { id: "estadisticas", etiqueta: "Estadísticas", breadcrumb: "Dashboard", icono: IconChart },
  { id: "conexiones", etiqueta: "Conexiones", breadcrumb: "Conexiones", icono: IconPlug },
  { id: "chats", etiqueta: "Estados de chats", breadcrumb: "Chats", icono: IconChat },
  { id: "archivos", etiqueta: "Archivos", breadcrumb: "Archivos", icono: IconFolder },
];

// Un bot "assistant" no vende ni agenda: no tiene funnel, catálogo ni chats de
// clientes que mostrar. Su navegación es su propio par de pestañas.
const PESTANAS_ASISTENTE: Tab[] = [
  { id: "asistente", etiqueta: "Asistente", breadcrumb: "Asistente virtual", icono: IconSparkles },
  { id: "conexiones", etiqueta: "Conexiones", breadcrumb: "Conexiones", icono: IconPlug },
];

const MES_ANIO = new Date()
  .toLocaleDateString("es", { month: "long", year: "numeric" })
  .toUpperCase();

export default function App() {
  const [negocio, setNegocio] = useState<Negocio>(() => negocioInicial());
  const [autenticado, setAutenticado] = useState<boolean | null>(null);
  const [acceso, setAcceso] = useState<EstadoAcceso | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [pestana, setPestana] = useState<Pestana>("estadisticas");
  const [sidebarAbierto, setSidebarAbierto] = useState(false);
  const [descargandoPdf, setDescargandoPdf] = useState(false);
  const {
    metricas,
    servicios,
    preguntas,
    categorias,
    clientesPorDia,
    clientesRequierenHumano,
    embudo,
    clientesAgendados,
    proximasCitas,
    stockBajo,
    cargando,
    error,
    recargar,
  } = useDashboardData();

  const esAsistente = negocio.kind === "assistant";
  const PESTANAS = esAsistente ? PESTANAS_ASISTENTE : PESTANAS_VENTA;

  useEffect(() => {
    void cargarNegocio().then((datos) => {
      if (!datos) return;
      setNegocio(datos);
      document.title = `${datos.nombre} — Dashboard`;
      // El layout del bot de ventas es la pestaña por defecto mientras no
      // sabemos el tipo de bot; en cuanto llega la respuesta y es un
      // asistente, movemos al usuario a SU pestaña por defecto.
      if (datos.kind === "assistant") setPestana("asistente");
    });

    supabase.auth.getSession().then(({ data }) => {
      setAutenticado(Boolean(data.session));
      setEmail(data.session?.user?.email ?? null);
    });
    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, session) => {
      setAutenticado(Boolean(session));
      setEmail(session?.user?.email ?? null);
      if (!session) setAcceso(null);
    });
    return () => suscripcion.subscription.unsubscribe();
  }, []);

  // Con sesión válida, comprobar UNA vez si el correo está autorizado en el
  // backend. Así mostramos un mensaje claro en vez de entrar al dashboard y
  // que cada panel falle con 401 (que además causaba el bucle de logout).
  useEffect(() => {
    if (autenticado) {
      setAcceso(null);
      verificarAcceso().then(setAcceso);
    }
  }, [autenticado]);

  async function descargarReportePdf() {
    setDescargandoPdf(true);
    try {
      const res = await adminFetch("/reportes/diario.pdf");
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert("No se pudo generar el reporte en PDF.");
    } finally {
      setDescargandoPdf(false);
    }
  }

  async function cerrarSesion() {
    await logout();
  }

  if (autenticado === null) {
    return <Pantalla mensaje="Comprobando sesión…" />;
  }

  if (!autenticado) {
    return <Login negocio={negocio} onLogin={() => setAutenticado(true)} />;
  }

  if (acceso === null) {
    return <Pantalla mensaje="Verificando acceso…" />;
  }

  if (acceso.estado !== "autorizado") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4">
        <div className="card w-full p-6">
          <h1 className="mb-2 flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--bad)" }}>
            <IconWarning /> {acceso.estado === "sin-acceso" ? "Sin acceso" : "No se pudo entrar"}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {acceso.mensaje}
          </p>
          {acceso.estado === "sin-acceso" && (
            <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
              Tu correo debe estar en <code>adminEmails</code> del archivo de configuración de este cliente
              (config/tenants/&lt;slug&gt;.json) en el backend.
            </p>
          )}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAcceso(null);
                verificarAcceso().then(setAcceso);
              }}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-white"
              style={{ background: "var(--accent)" }}
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={cerrarSesion}
              className="rounded-md border px-3 py-1.5 text-sm font-medium"
              style={{ borderColor: "var(--border-strong)", color: "var(--text-secondary)" }}
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Defensivo: si `pestana` quedó apuntando a una pestaña que no existe en
  // este layout (ej. justo al resolver el tipo de bot), cae a la primera.
  const activa = PESTANAS.find((p) => p.id === pestana) ?? PESTANAS[0];

  return (
    <div className="min-h-screen">
      {/* Overlay para cerrar la barra lateral en móvil */}
      {sidebarAbierto && (
        <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarAbierto(false)} />
      )}

      {/* Barra lateral */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-60 flex-col justify-between border-r px-3 py-4 transition-transform md:translate-x-0 ${
          sidebarAbierto ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--sidebar)", borderColor: "var(--border)" }}
      >
        <div>
          <div className="mb-6 flex items-center gap-3 px-2">
            <Logo size={36} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{negocio.nombre}</p>
              <p className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
                {negocio.subtitulo}
              </p>
            </div>
          </div>

          <p className="eyebrow mb-2 px-3">Operaciones</p>
          <nav className="flex flex-col gap-1">
            {PESTANAS.map((p) => {
              const Icono = p.icono;
              return (
                <button
                  key={p.id}
                  type="button"
                  data-activo={pestana === p.id}
                  onClick={() => {
                    setPestana(p.id);
                    setSidebarAbierto(false);
                  }}
                  className="nav-item"
                >
                  <Icono size={17} />
                  <span className="flex-1 text-left">{p.etiqueta}</span>
                  {p.id === "chats" && clientesRequierenHumano.length > 0 && (
                    <span
                      className="rounded-full px-1.5 text-xs font-semibold"
                      style={{ background: "var(--bad)", color: "#fff" }}
                    >
                      {clientesRequierenHumano.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
          {email && (
            <p className="mb-2 truncate px-3 text-xs" style={{ color: "var(--text-muted)" }} title={email}>
              {email}
            </p>
          )}
          <button type="button" onClick={cerrarSesion} className="nav-item">
            <IconLogout size={17} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Columna principal */}
      <div className="md:pl-60">
        {/* Barra superior */}
        <header
          className="sticky top-0 z-10 flex items-center justify-between border-b px-4 py-3 backdrop-blur md:px-8"
          style={{ background: "color-mix(in srgb, var(--page) 85%, transparent)", borderColor: "var(--border)" }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarAbierto((v) => !v)}
              className="rounded-md p-1.5 md:hidden"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Abrir menú"
            >
              <IconPanelLeft size={18} />
            </button>
            <div>
              <p className="eyebrow">Consola</p>
              <p className="text-sm font-semibold">{activa.breadcrumb}</p>
            </div>
          </div>
          <span className="pill" style={{ background: "var(--good-soft)", color: "var(--good)", borderColor: "transparent" }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--good)" }} />
            Sistema operativo
          </span>
        </header>

        <main className="px-4 py-6 md:px-8 md:py-8">
          {error && (
            <div className="card mb-6 flex items-center gap-2 p-4 text-sm" role="alert">
              <IconWarning className="shrink-0" style={{ color: "var(--bad)" }} />
              Error cargando datos: {error}. Verifica las variables VITE_SUPABASE_* y que el esquema SQL esté aplicado.
            </div>
          )}

          {cargando && !metricas ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Cargando métricas…
            </p>
          ) : (
            <>
              {pestana === "estadisticas" && (
                <>
                  <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                      <p className="eyebrow mb-1">Resumen global · {MES_ANIO}</p>
                      <h1 className="text-3xl font-semibold tracking-tight">Bienvenido de nuevo</h1>
                      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                        Vista en tiempo real de clientes, conversión y citas del bot de WhatsApp.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={descargarReportePdf}
                      disabled={descargandoPdf}
                      className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                      style={{ background: "var(--accent)" }}
                    >
                      <IconDownload size={16} />
                      {descargandoPdf ? "Generando…" : "Reporte PDF"}
                    </button>
                  </div>

                  <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
                    <MetricCard
                      titulo="Escribieron hoy"
                      valor={metricas?.clientes_activos_hoy ?? 0}
                      icono={IconChat}
                      detalle={`${metricas?.clientes_nuevos_hoy ?? 0} nuevos · ${metricas?.mensajes_hoy ?? 0} mensajes`}
                    />
                    <MetricCard
                      titulo="Tasa de conversión"
                      valor={`${metricas?.tasa_conversion_pct ?? 0}%`}
                      icono={IconPercent}
                      detalle={`${metricas?.clientes_convertidos ?? 0} de ${metricas?.clientes_totales ?? 0} clientes`}
                    />
                    <MetricCard titulo="Citas de hoy" valor={metricas?.citas_hoy ?? 0} icono={IconCalendar} />
                    <MetricCard
                      titulo="Clientes nuevos"
                      valor={metricas?.clientes_nuevos_semana ?? 0}
                      icono={IconUsers}
                      detalle={`esta semana · ${metricas?.clientes_nuevos_mes ?? 0} este mes`}
                    />
                  </section>

                  <section className="mb-6">
                    <OperacionesHoy proximasCitas={proximasCitas} stockBajo={stockBajo} />
                  </section>

                  <section className="mb-6 grid gap-4 lg:grid-cols-2">
                    <ClientesPorDiaChart data={clientesPorDia} />
                    <CategoriasChart data={categorias} />
                  </section>

                  <section className="grid gap-4 lg:grid-cols-2">
                    <ServiciosChart data={servicios} />
                    <PreguntasTable data={preguntas} />
                  </section>
                </>
              )}

              {pestana === "conexiones" && esAsistente && (
                <>
                  <EncabezadoSeccion
                    titulo="Conexiones"
                    descripcion="El WhatsApp donde este asistente te avisa cuando necesita tu criterio."
                  />
                  <WhatsAppStatus />
                </>
              )}

              {pestana === "conexiones" && !esAsistente && (
                <>
                  <EncabezadoSeccion titulo="Conexiones" descripcion="WhatsApp, Google Calendar y alertas del equipo." />
                  <section className="mb-6">
                    <WhatsAppStatus />
                  </section>
                  <section className="mb-6">
                    <GoogleCalendarStatus />
                  </section>
                  <Empleados />
                </>
              )}

              {pestana === "chats" && (
                <>
                  <EncabezadoSeccion titulo="Estados de chats" descripcion="Casos escalados y clientes por etapa del embudo." />
                  <SolicitudesHumanas clientes={clientesRequierenHumano} alActualizar={recargar} />
                  <EstadosChats embudo={embudo} clientesAgendados={clientesAgendados} />
                </>
              )}

              {pestana === "archivos" && (
                <>
                  <EncabezadoSeccion titulo="Archivos" descripcion="Carga y actualiza el catálogo de productos/servicios." />
                  <CatalogoUpload />
                </>
              )}

              {pestana === "asistente" && (
                <>
                  <EncabezadoSeccion
                    titulo="Asistente virtual"
                    descripcion="Triaje de correo: qué se descartó solo, qué quedó listo como borrador y qué necesita tu criterio."
                  />
                  <section className="mb-6">
                    <AsistenteConexionGmail />
                  </section>
                  <AsistentePanel />
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function Pantalla({ mensaje }: { mensaje: string }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-sm items-center justify-center px-4">
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        {mensaje}
      </p>
    </div>
  );
}

function EncabezadoSeccion({ titulo, descripcion }: { titulo: string; descripcion: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--text-secondary)" }}>
        {descripcion}
      </p>
    </div>
  );
}
