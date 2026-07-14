import { Type, type FunctionDeclaration } from "@google/genai";

/**
 * Definiciones de las funciones (tools) que la IA puede invocar durante la
 * conversación. Genéricas — sirven para cualquier rubro de negocio. La
 * ejecución real está en `executor.ts`.
 */
export const tools: FunctionDeclaration[] = [
  {
    name: "consultar_catalogo",
    description:
      "Busca productos/servicios en el catálogo del negocio. Úsala SIEMPRE que el cliente pregunte por precios, " +
      "disponibilidad o algo que el negocio ofrezca. Devuelve nombre, categoría, precio, moneda, disponibilidad, " +
      "stock (si aplica) y garantía. Nunca inventes precios ni existencias: si no hay resultados, dilo honestamente.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        busqueda: {
          type: Type.STRING,
          description: "Términos de búsqueda del producto/servicio que pide el cliente.",
        },
        categoria: {
          type: Type.STRING,
          description: "Categoría si el cliente la mencionó (opcional, texto libre del negocio)",
        },
      },
      required: ["busqueda"],
    },
  },
  {
    name: "etiquetar_cliente",
    description:
      "Actualiza el estado del cliente en el embudo. Úsala cuando la conversación revele un cambio de etapa: " +
      "'interesado' cuando pregunta por productos/servicios, 'cotizado' cuando le das un precio concreto, " +
      "'agendado' cuando confirma una cita, 'perdido' si rechaza explícitamente, " +
      "'requiere_humano' si pide hablar con una persona o el caso excede tus capacidades.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        estado: {
          type: Type.STRING,
          enum: ["nuevo", "interesado", "cotizado", "agendado", "cliente", "perdido", "requiere_humano"],
          description: "Nueva etapa del cliente en el embudo",
        },
        notas: {
          type: Type.STRING,
          description: "Resumen breve del contexto: qué quiere, preferencias, objeciones.",
        },
        etiquetas: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Etiquetas libres para clasificar el chat (puedes poner varias): 'cotizado', 'cita', " +
            "'hablar_con_empleado', 'atendido', 'seguimiento', 'recurrente', 'urgente', etc.",
        },
      },
      required: ["estado"],
    },
  },
  {
    name: "verificar_disponibilidad",
    description: "Verifica si un horario está libre en la agenda del negocio ANTES de confirmar una cita al cliente.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        inicio_iso: {
          type: Type.STRING,
          description: "Fecha y hora propuesta en formato ISO 8601 con zona horaria del negocio, ej: 2026-07-13T10:00:00-04:00",
        },
        duracion_minutos: {
          type: Type.INTEGER,
          description: "Duración estimada en minutos (default 60)",
        },
      },
      required: ["inicio_iso"],
    },
  },
  {
    name: "agendar_cita",
    description:
      "Crea una cita en el calendario del negocio. Úsala SOLO después de que el cliente confirme explícitamente " +
      "fecha y hora, y de haber verificado con verificar_disponibilidad.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        inicio_iso: {
          type: Type.STRING,
          description: "Fecha y hora confirmada en ISO 8601 con zona horaria del negocio, ej: 2026-07-13T10:00:00-04:00",
        },
        duracion_minutos: {
          type: Type.INTEGER,
          description: "Duración estimada en minutos (default 60)",
        },
        motivo: {
          type: Type.STRING,
          description: "Motivo de la cita, ej: 'Corte de cabello' o 'Consulta inicial'",
        },
      },
      required: ["inicio_iso", "motivo"],
    },
  },
  {
    name: "registrar_consulta",
    description:
      "Registra la intención/pregunta del cliente para analíticas del negocio. Úsala UNA vez por cada pregunta " +
      "sustancial (precio, disponibilidad, horario, cita, envío, pago, garantía). " +
      "Normaliza la pregunta a una forma corta y genérica, ej: 'precio corte de cabello'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        categoria: {
          type: Type.STRING,
          enum: ["precio", "disponibilidad", "horario_ubicacion", "cita", "envio", "pago", "garantia", "otra"],
        },
        pregunta: {
          type: Type.STRING,
          description: "Pregunta normalizada en minúsculas, corta y genérica",
        },
        servicio_texto: {
          type: Type.STRING,
          description: "Producto/servicio mencionado por el cliente, aunque no exista en el catálogo.",
        },
        servicio_id: {
          type: Type.STRING,
          description: "UUID del producto/servicio del catálogo si consultar_catalogo devolvió una coincidencia",
        },
      },
      required: ["categoria", "pregunta"],
    },
  },
];
