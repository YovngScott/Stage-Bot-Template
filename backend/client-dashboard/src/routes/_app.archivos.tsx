import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CloudUpload,
  FileSpreadsheet,
  Loader2,
  Tag,
  X,
} from "lucide-react";
import { CardShell } from "@/components/dashboard/CardShell";
import { Button } from "@/components/ui/button";
import { adminFetch, getApiUrl } from "@/lib/api";

export const Route = createFileRoute("/_app/archivos")({
  head: () => ({
    meta: [
      { title: "Archivos · Stage AI Labs" },
      {
        name: "description",
        content:
          "Sube tu catálogo en Excel o CSV para que el bot responda con productos actualizados.",
      },
    ],
  }),
  component: ArchivosPage,
});

const requiredCols = [
  { name: "nombre", desc: "Nombre del producto o servicio" },
  { name: "precio", desc: "Precio numérico" },
  { name: "descripcion", desc: "Descripción corta (opcional)" },
  { name: "categoria", desc: "Categoría o familia" },
  { name: "stock", desc: "Unidades disponibles (opcional)" },
];

type Modo = "catalogo" | "preciosStock";

const ENDPOINT: Record<Modo, string> = {
  catalogo: "/servicios/importar",
  preciosStock: "/servicios/precios-stock",
};

// Los dos endpoints devuelven contadores distintos; guardamos el crudo y lo
// renderizamos según el modo.
interface ResultadoCrudo {
  filasLeidas?: number;
  insertadas?: number;
  actualizadas?: number;
  descartadas?: number;
  noEncontradas?: number;
  errores?: string[];
}

interface Carga {
  id: string;
  name: string;
  size: number;
  modo: Modo;
  status: "subiendo" | "ok" | "error";
  resultado?: ResultadoCrudo;
  mensaje?: string;
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function resumen(c: Carga): string {
  const r = c.resultado;
  if (!r) return "";
  if (c.modo === "preciosStock") {
    const partes = [`${r.filasLeidas ?? 0} filas`];
    if (r.insertadas) partes.push(`${r.insertadas} nuevas`);
    partes.push(`${r.actualizadas ?? 0} actualizadas`);
    if (r.noEncontradas) partes.push(`${r.noEncontradas} no encontradas`);
    if (r.descartadas) partes.push(`${r.descartadas} descartadas`);
    return partes.join(" · ");
  }
  const partes = [
    `${r.filasLeidas ?? 0} filas`,
    `${r.insertadas ?? 0} nuevas`,
    `${r.actualizadas ?? 0} actualizadas`,
  ];
  if (r.descartadas) partes.push(`${r.descartadas} descartadas`);
  return partes.join(" · ");
}

function ArchivosPage() {
  const [cargas, setCargas] = useState<Carga[]>([]);
  const apiConfigurada = Boolean(getApiUrl());

  async function subir(file: File, modo: Modo) {
    const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setCargas((prev) => [
      { id, name: file.name, size: file.size, modo, status: "subiendo" },
      ...prev,
    ]);

    if (!apiConfigurada) {
      setCargas((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "error",
                mensaje: "Falta configurar VITE_API_URL para subir archivos.",
              }
            : c,
        ),
      );
      return;
    }

    try {
      const formData = new FormData();
      formData.append("archivo", file);
      const res = await adminFetch(ENDPOINT[modo], { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      setCargas((prev) =>
        prev.map((c) =>
          c.id === id ? { ...c, status: "ok", resultado: data as ResultadoCrudo } : c,
        ),
      );
    } catch (err) {
      setCargas((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "error",
                mensaje: err instanceof Error ? err.message : "Error subiendo el archivo",
              }
            : c,
        ),
      );
    }
  }

  function procesar(list: File[], modo: Modo) {
    list.filter((f) => /\.(csv|xlsx|xls)$/i.test(f.name)).forEach((f) => void subir(f, modo));
  }

  return (
    <div className="space-y-6">
      {/* Catálogo completo */}
      <DropZone
        variant="grande"
        titulo="Arrastra tu catálogo aquí"
        subtitulo={
          <>
            o haz clic para seleccionar archivos
            <span className="mx-1 text-muted-foreground/50">·</span>
            <span className="font-mono text-xs">.csv .xlsx .xls</span> hasta 20MB
          </>
        }
        onFiles={(list) => procesar(list, "catalogo")}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <CardShell title="Columnas requeridas">
          <ul className="space-y-2.5">
            {requiredCols.map((c) => (
              <li key={c.name} className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="font-mono text-xs text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardShell>

        {/* Actualización rápida de solo precios y stock (no toca el resto) */}
        <CardShell title="Actualizar precios y stock">
          <p className="mb-3 text-xs text-muted-foreground">
            ¿Solo cambiaron precios o cantidades? Sube un Excel/CSV con{" "}
            <span className="font-mono text-foreground">nombre</span> y{" "}
            <span className="font-mono text-foreground">precio</span> y/o{" "}
            <span className="font-mono text-foreground">stock</span>. Actualiza solo esos campos de
            los productos que ya existen — no borra descripciones ni categorías.
          </p>
          <DropZone
            variant="compacto"
            titulo="Arrastra precios y stock"
            subtitulo={
              <>
                nombre + precio y/o stock
                <span className="mx-1 text-muted-foreground/50">·</span>
                <span className="font-mono text-xs">.csv .xlsx .xls</span>
              </>
            }
            icon={<Tag className="h-6 w-6 text-white" strokeWidth={2} />}
            onFiles={(list) => procesar(list, "preciosStock")}
          />
        </CardShell>
      </div>

      <CardShell title={`Cargas recientes (${cargas.length})`}>
        {cargas.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileSpreadsheet className="h-8 w-8 text-muted-foreground/40" />
            <p className="mt-2 text-sm text-muted-foreground">Aún no has cargado ningún archivo.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {cargas.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3"
              >
                <div
                  className={[
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    c.status === "ok"
                      ? "bg-emerald-500/10 text-emerald-300"
                      : c.status === "error"
                        ? "bg-rose-500/10 text-rose-300"
                        : "bg-primary/10 text-primary",
                  ].join(" ")}
                >
                  {c.status === "subiendo" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : c.status === "ok" ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <AlertCircle className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                    <span className="shrink-0 rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {c.modo === "preciosStock" ? "precios/stock" : "catálogo"}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{fmtSize(c.size)}</p>
                  {c.status === "ok" && c.resultado && (
                    <p className="mt-1 text-[11px] text-emerald-300/90">{resumen(c)}</p>
                  )}
                  {c.status === "ok" && c.resultado?.errores && c.resultado.errores.length > 0 && (
                    <p className="mt-1 text-[11px] text-amber-300/90">
                      {c.resultado.errores[0]}
                      {c.resultado.errores.length > 1 &&
                        ` (+${c.resultado.errores.length - 1} más)`}
                    </p>
                  )}
                  {c.status === "error" && (
                    <p className="mt-1 text-[11px] text-rose-300/90">{c.mensaje}</p>
                  )}
                </div>
                <button
                  onClick={() => setCargas((prev) => prev.filter((x) => x.id !== c.id))}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-destructive"
                  aria-label="Quitar"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardShell>
    </div>
  );
}

function DropZone({
  variant,
  titulo,
  subtitulo,
  icon,
  onFiles,
}: {
  variant: "grande" | "compacto";
  titulo: string;
  subtitulo: React.ReactNode;
  icon?: React.ReactNode;
  onFiles: (files: File[]) => void;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const grande = variant === "grande";

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      onClick={() => inputRef.current?.click()}
      className={[
        "relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed text-center transition-all duration-300",
        grande ? "p-12" : "p-6",
        drag
          ? "border-primary bg-primary/10 scale-[1.01] glow-primary"
          : "border-white/10 bg-card/40 hover:border-white/20 hover:bg-card/60",
      ].join(" ")}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-3xl" />
      </div>

      <div className="relative">
        <div
          className={[
            "mx-auto flex items-center justify-center rounded-2xl ai-gradient-bg glow-primary",
            grande ? "h-16 w-16" : "h-12 w-12",
          ].join(" ")}
        >
          {icon ?? <CloudUpload className="h-8 w-8 text-white" strokeWidth={2} />}
        </div>
        <h3
          className={[
            "font-semibold tracking-tight text-foreground",
            grande ? "mt-5 text-lg" : "mt-4 text-base",
          ].join(" ")}
        >
          {titulo}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{subtitulo}</p>

        {grande && (
          <Button
            className="mt-5 ai-gradient-bg text-white hover:opacity-90"
            onClick={(e) => {
              e.stopPropagation();
              inputRef.current?.click();
            }}
          >
            Seleccionar archivo
          </Button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => {
            const list = e.target.files ? Array.from(e.target.files) : [];
            onFiles(list);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
