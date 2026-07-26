/**
 * Última barrera antes de que una respuesta salga a nombre del titular.
 *
 * El prompt del clasificador ya prohíbe plantillas a medio llenar, pero un
 * prompt es una petición, no una garantía: en la primera prueba real el modelo
 * envió "Nos dedicamos a [breve descripción de la empresa, si es posible]" a un
 * destinatario de verdad. Esto es lo que lo habría impedido.
 *
 * La regla: ante la menor sospecha NO se envía. El costo de un falso positivo
 * es un borrador de más que el titular revisa; el de un falso negativo es un
 * correo vergonzoso, irreversible y firmado con su nombre.
 */

/** Huecos de plantilla que el modelo dejó sin rellenar. */
const PLACEHOLDERS = [
  // [texto], {texto}, {{texto}}, <texto> — la forma clásica de un hueco.
  /\[[^\]\n]{2,}\]/,
  /\{\{?[^}\n]{2,}\}?\}/,
  /<[a-záéíóúñ][a-záéíóúñ\s_-]{2,}>/i,
  // Marcadores literales de "falta completar".
  /\bx{3,}\b/i,
  /\b(TODO|TBD|FIXME|N\/A)\b/,
  // Instrucción que el modelo se dejó a sí mismo. Se exige que ARRANQUE una
  // oración: así "Completar aquí los detalles" se bloquea, pero "puede
  // completar el formulario" —dirigido al destinatario— pasa sin problema.
  // (Nota: se usa \s en vez de \b al cerrar porque \b no funciona tras una
  // vocal acentuada como la de "aquí".)
  /(^|[.!?]\s+)(inserta[rn]?|complet[ae]r?|rellen[ae]r?|especific[ao]r?|añad[ei]r?)\s+(aquí|el|la|los|las|su|tu)\s/i,
  /\b(nombre|fecha|precio|monto|cantidad|dirección|teléfono)\s+(del?\s+)?(cliente|destinatario|empresa|producto)\b\s*[:.]?\s*$/im,
  // Notas del modelo para sí mismo.
  /\((nota|aclaración|opcional|si (es )?posible|si aplica)[^)]*\)/i,
];

/** Frases que delatan que el modelo no supo qué responder. */
const EVASIVAS = [
  /\bno (tengo|dispongo de|cuento con) (la |esa |suficiente )?(información|datos|contexto)\b/i,
  /\bcomo (asistente|modelo|ia|inteligencia artificial)\b/i,
  /\bno puedo (responder|ayudar|proporcionar)\b/i,
];

/** Largo mínimo razonable de una respuesta cortés. Por debajo, algo se truncó. */
const LARGO_MINIMO = 25;

export interface ResultadoValidacion {
  /** true = se puede enviar sin que lo vea una persona. */
  seguro: boolean;
  /** Qué disparó el bloqueo, para el aviso al titular y para auditar. */
  motivo: string | null;
}

/**
 * ¿Es seguro enviar este texto sin revisión humana? Solo mira el texto: la
 * decisión de si el ASUNTO amerita al titular la toma el clasificador aparte.
 */
export function validarParaEnvio(cuerpo: string): ResultadoValidacion {
  const texto = (cuerpo ?? "").trim();

  if (texto.length < LARGO_MINIMO) {
    return { seguro: false, motivo: "La respuesta quedó demasiado corta o vacía." };
  }

  for (const patron of PLACEHOLDERS) {
    const coincidencia = texto.match(patron);
    if (coincidencia) {
      return {
        seguro: false,
        motivo: `La respuesta tiene un hueco sin rellenar: "${coincidencia[0].slice(0, 60)}".`,
      };
    }
  }

  for (const patron of EVASIVAS) {
    if (patron.test(texto)) {
      return { seguro: false, motivo: "La respuesta admite que le falta información o revela que es una IA." };
    }
  }

  return { seguro: true, motivo: null };
}
