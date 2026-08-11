export class AIUnavailableError extends AggregateError {
  readonly code = "AI_UNAVAILABLE";
  constructor(errors: unknown[]) {
    super(errors, "Todos los proveedores de inteligencia artificial están temporalmente fuera de servicio.");
    this.name = "AIUnavailableError";
  }
}

export async function runProviderFallback<T>(providers: Array<() => Promise<T>>): Promise<T> {
  const errors: unknown[] = [];
  for (const provider of providers) {
    try {
      return await provider();
    } catch (error) {
      errors.push(error);
    }
  }
  throw new AIUnavailableError(errors);
}
