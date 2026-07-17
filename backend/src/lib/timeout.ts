/**
 * Envuelve una promesa con un límite de tiempo. Si `promesa` no resuelve
 * antes de `ms`, rechaza con un error claro. Clave para que una llamada de IA
 * colgada NUNCA deje al bot en "escribiendo…" para siempre: el timeout la
 * corta y el flujo sigue hacia un mensaje de respaldo.
 */
export function conTimeout<T>(promesa: Promise<T>, ms: number, etiqueta = "operación"): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`Timeout de ${ms}ms en ${etiqueta}`));
    }, ms);
    promesa.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
