"use client";

/**
 * Small browser utilities for the console: clipboard, authenticated downloads
 * and safe post-login redirects.
 */
import { ApiClientError } from "./api";

/** Copy text to the clipboard. Resolves false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function filenameFrom(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* ignore */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1] : fallback;
}

/**
 * Download a file from an authenticated API route (same-origin cookie session).
 * Throws `ApiClientError` with the server's message on failure.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiClientError(0, "network", "Can't reach Infera. Check your connection.");
  }
  if (!res.ok) {
    let code = String(res.status);
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
    } catch {
      /* not JSON */
    }
    throw new ApiClientError(res.status, code, message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFrom(res.headers.get("content-disposition"), fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Validate a `?next=` redirect target: only same-site absolute paths are allowed
 * (no protocol-relative `//host`, no backslash tricks). Falls back to `fallback`.
 */
/** Where people land after signing in: connect WhatsApp (or the Inbox once it is linked). */
export const START_PATH = "/console/connect";

export function safeNext(next: string | null | undefined, fallback = START_PATH): string {
  if (!next || typeof next !== "string") return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n\t]/.test(next)) return fallback;
  // Don't bounce back into the auth pages.
  if (/^\/(login|signup)(\/|\?|$)/.test(next)) return fallback;
  return next;
}
