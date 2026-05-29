// Observability seam. A minimal `Tracer` the executor emits lifecycle events to,
// so an operator can wire OpenTelemetry (or any backend) WITHOUT this repo taking
// a hard OTel dependency. Defaults to a no-op; a console tracer is provided for
// local use. The signed audit log remains the source of truth — this is for
// live operational visibility, not the record.

export interface Tracer {
  event(name: string, attributes?: Record<string, unknown>): void;
}

export const noopTracer: Tracer = {
  event() {},
};

export function consoleTracer(): Tracer {
  return {
    event(name, attributes) {
      console.error(`[trace] ${name}`, attributes ?? {});
    },
  };
}
