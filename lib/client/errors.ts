"use client";

/**
 * Turning API errors into words people can act on.
 *
 *   catch (e) { toast({ title: "Couldn't save", body: errorMessage(e) }); }
 *   const fields = fieldErrors(e);   // { email: "Enter a valid email address." }
 */
import { ApiClientError } from "./api";

/** Server validation messages are prefixed with the field path ("email: …"); strip it for display. */
export function stripFieldPrefix(message: string): string {
  return message.replace(/^[A-Za-z_][\w.[\]]*:\s+/, "");
}

/** A user-facing message for any thrown value. */
export function errorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof ApiClientError) {
    switch (e.code) {
      case "network":
        return "Can't reach Infera. Check your connection and try again.";
      case "rate_limited":
        return e.message || "Too many attempts. Please wait a minute and try again.";
      case "invalid":
        return stripFieldPrefix(e.message);
      case "forbidden":
        return e.message || "You don't have permission to do that.";
      default:
        if (e.status === 404 && /^Request failed/.test(e.message)) return "This feature isn't available on this server yet.";
        if (e.status >= 500 && /^Request failed/.test(e.message)) return "The server hit a problem. Please try again in a moment.";
        return e.message || fallback;
    }
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/**
 * Field-level messages from a 422 `invalid` error, keyed by field path
 * (`details: [{ path, message }]`, or the "field: message" prefix as a fallback).
 */
export function fieldErrors(e: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!(e instanceof ApiClientError) || e.code !== "invalid") return out;
  if (Array.isArray(e.details)) {
    for (const d of e.details as { path?: unknown; message?: unknown }[]) {
      if (typeof d?.path === "string" && typeof d.message === "string" && !(d.path in out)) out[d.path || "body"] = d.message;
    }
  }
  if (!Object.keys(out).length) {
    const m = /^([A-Za-z_][\w.[\]]*):\s+(.*)$/.exec(e.message);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** HTTP status of an API error (0 for network/unknown). */
export const errorStatus = (e: unknown): number => (e instanceof ApiClientError ? e.status : 0);

/** True for 404 — used to show "not available yet" states for endpoints still being rolled out. */
export const isNotFound = (e: unknown): boolean => errorStatus(e) === 404;

/** True for 403. */
export const isForbidden = (e: unknown): boolean => errorStatus(e) === 403;
