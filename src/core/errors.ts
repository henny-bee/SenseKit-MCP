// Structured tool errors. Every failure a tool reports reaches the client as
// MCP `isError: true` with JSON text `{ code, message, details? }` (see
// tools/error-boundary.ts), so an agent can branch on `code` instead of
// pattern-matching prose. The human-readable `message` wording is kept
// stable — agents and runbooks already key on phrases like "refusing to
// create:".

/** The fixed code set. Add a code only when a caller would act differently
 *  on it than on every existing one. */
export const ERROR_CODES = [
  /** The request itself is malformed (missing/contradictory arguments). */
  "INVALID_INPUT",
  /** A referenced app object, sheet child, stream, master item ... does not exist. */
  "NOT_FOUND",
  /** A pre-flight or safety check refused the change (unknown field, bad
   *  expression, impossible chart shape, redacted script ...). */
  "VALIDATION_REFUSED",
  /** Refused because other objects still depend on the target (details lists them). */
  "REFERENCED",
  /** Would collide with an existing item (e.g. duplicate master-item title). */
  "CONFLICT",
  /** The Qlik engine (QIX) failed or refused the operation. */
  "ENGINE_ERROR",
  /** The Repository Service (QRS) returned an error. */
  "QRS_ERROR",
  /** The Proxy Service (QPS) returned an error. */
  "PROXY_ERROR",
  /** Authentication/authorization failed (401/403, CSRF/session bootstrap). */
  "AUTH_ERROR",
  /** Anything unexpected — a bug, not a user error. */
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class ToolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

/** Message of anything thrown — Error or not — for refusal texts. */
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Map anything thrown to the wire payload. enigma.js rejects with an Error
 *  carrying the engine's numeric JSON-RPC `code` (e.g. -128 "object not
 *  found"); those are engine errors. Everything else unknown is INTERNAL. */
export function toErrorPayload(e: unknown): ErrorPayload {
  if (e instanceof ToolError) {
    return { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) };
  }
  if (e instanceof Error) {
    const engineCode = (e as Error & { code?: unknown }).code;
    if (typeof engineCode === "number") return { code: "ENGINE_ERROR", message: e.message, details: { engineCode } };
    return { code: "INTERNAL", message: e.message };
  }
  return { code: "INTERNAL", message: String(e) };
}

/** Classify an HTTP failure from a Qlik REST service: 401/403 are auth
 *  problems wherever they come from, 404 is a missing entity, the rest is
 *  the service's own error. */
export function httpErrorCode(status: number | undefined, service: "QRS_ERROR" | "PROXY_ERROR" | "ENGINE_ERROR"): ErrorCode {
  if (status === 401 || status === 403) return "AUTH_ERROR";
  if (status === 404) return "NOT_FOUND";
  return service;
}
