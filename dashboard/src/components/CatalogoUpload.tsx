import { useRef, useState } from "react";
import { adminFetch, getApiUrl } from "../lib/api";
import { IconCheck, IconWarning } from "./Icons";

const API_URL = getApiUrl();

interface ResultadoImportacion {
  archivo: string;
  filasLeidas: number;
  insertadas: number;
  actualizadas: number;
  descartadas: number;
  errores: string[];
}

type Estado =
  | { tipo: "idle" }
  | { tipo: "cargando" }
  | { tipo: "ok"; resultado: ResultadoImportacion }
  | { tipo: "error"; mensaje: string };

/**
 * Zona de arrastre para subir el catálogo completo (Excel/CSV). Columnas
 * esperadas: nombre, precio (obligatorias); categoria, descripcion, moneda,
 * stock, garantia_dias, sku, disponible (opcionales). Empareja por nombre al
 * re-subir: actualiza las filas existentes, inserta las nuevas.
 */
export function CatalogoUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "idle" });
  const [arrastrando, setArrastrando] = useState(false);

  async function subirArchivo(file: File) {
    if (!API_URL) {
      setEstado({ tipo: "error", mensaje: "Falta configurar VITE_API_URL en el .env del dashboard." });
      return;
    }
    setEstado({ tipo: "cargando" });
    const formData = new FormData();
    formData.append("archivo", file);
    try {
      const res = await adminFetch("/servicios/importar", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
      setEstado({ tipo: "ok", resultado: data as ResultadoImportacion });
    } catch (e: any) {
      setEstado({ tipo: "error", mensaje: e?.message ?? "Error subiendo el archivo" });
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setArrastrando(false);
    const file = e.dataTransfer.files?.[0];
    if (file) subirArchivo(file);
  }

  return (
    <div className="card p-5">
      <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Cargar catálogo
      </h2>
      <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
        Excel/CSV con columnas: <code>nombre</code>, <code>precio</code> (obligatorias); <code>categoria</code>,{" "}
        <code>descripcion</code>, <code>moneda</code>, <code>stock</code>, <code>garantia_dias</code>, <code>sku</code>,{" "}
        <code>disponible</code> (opcionales). Empareja por nombre: actualiza lo existente, agrega lo nuevo.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className="cursor-pointer rounded-lg border-2 border-dashed p-6 text-center text-sm transition-colors"
        style={{
          borderColor: arrastrando ? "var(--series-1)" : "var(--baseline)",
          color: "var(--text-secondary)",
        }}
      >
        {estado.tipo === "cargando" ? (
          "Procesando archivo…"
        ) : (
          <>
            Arrastra el archivo aquí o <span style={{ color: "var(--series-1)" }}>haz clic para elegirlo</span>
            <br />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              Excel o CSV
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) subirArchivo(file);
            e.target.value = "";
          }}
        />
      </div>

      {estado.tipo === "ok" && (
        <div className="mt-4 text-sm" style={{ color: "var(--text-primary)" }}>
          <p className="flex items-start gap-1.5">
            <IconCheck className="mt-0.5 shrink-0" style={{ color: "var(--good)" }} />
            <span>
              <strong>{estado.resultado.archivo}</strong>: {estado.resultado.filasLeidas} filas leídas —{" "}
              {estado.resultado.insertadas > 0 && (
                <>
                  <span style={{ color: "var(--good)" }}>{estado.resultado.insertadas} nuevas</span>,{" "}
                </>
              )}
              {estado.resultado.actualizadas} actualizadas
              {estado.resultado.descartadas > 0 && `, ${estado.resultado.descartadas} descartadas`}.
            </span>
          </p>
          {estado.resultado.errores.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs" style={{ color: "var(--text-muted)" }}>
              {estado.resultado.errores.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {estado.tipo === "error" && (
        <p className="mt-4 flex items-center gap-1.5 text-sm" role="alert" style={{ color: "#d03b3b" }}>
          <IconWarning /> {estado.mensaje}
        </p>
      )}
    </div>
  );
}
