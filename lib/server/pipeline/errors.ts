import { AiError } from "../ai/client";
import { ApiError } from "../api/handler";

/** Pipeline failure with a PII-free message and a retry hint for the job queue. */
export class PipelineError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryable = false,
  ) {
    super(message);
    this.name = "PipelineError";
  }
}

/** Postgres SQLSTATE classes/codes that are transient (connection loss, serialization, lock timeouts, overload). */
const TRANSIENT_PG = /^(08|40001|40P01|53|55P03|57P0[1-3])/;
const TRANSIENT_NODE = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "EAI_AGAIN"]);

/** Whether retrying the job could succeed. */
export function isRetryable(e: unknown): boolean {
  if (e instanceof PipelineError) return e.retryable;
  if (e instanceof AiError) return e.retryable;
  if (e instanceof ApiError) return false;
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && (TRANSIENT_PG.test(code) || TRANSIENT_NODE.has(code))) return true;
  const cause = (e as { cause?: unknown } | null)?.cause;
  if (cause && cause !== e) return isRetryable(cause);
  return false;
}

/**
 * Error text safe to store on the event / show in the UI: our own messages,
 * never driver errors (which can contain row values, i.e. personal data).
 */
export function safeErrorMessage(e: unknown): string {
  // 400s from the AI provider embed the provider's message; keep only our own wording.
  if (e instanceof AiError) return e.status === 400 ? "The AI request was rejected." : e.message.slice(0, 300);
  if (e instanceof PipelineError || e instanceof ApiError) return e.message.slice(0, 500);
  const code = (e as { code?: unknown } | null)?.code;
  const safeCode = typeof code === "string" && /^[A-Z0-9_]{2,16}$/i.test(code) ? code : null;
  return safeCode ? `Internal processing error (${safeCode}).` : "Internal processing error.";
}
