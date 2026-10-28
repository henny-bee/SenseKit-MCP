// Keep `message` wording stable: agents and runbooks match on it.

// Add a code only if a caller would act differently on it.
export const ERROR_CODES = [
  "INVALID_INPUT",
  "NOT_FOUND",
  "VALIDATION_REFUSED",
  "REFERENCED", // other objects still depend on the target
  "CONFLICT",
  "ENGINE_ERROR",
  "QRS_ERROR",
  "PROXY_ERROR",
  "AUTH_ERROR",
  "INTERNAL", // a bug, not a user error
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

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// enigma.js rejects with a numeric JSON-RPC `code`: that is an engine error.
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

export function httpErrorCode(status: number | undefined, service: "QRS_ERROR" | "PROXY_ERROR" | "ENGINE_ERROR"): ErrorCode {
  if (status === 401 || status === 403) return "AUTH_ERROR";
  if (status === 404) return "NOT_FOUND";
  return service;
}
