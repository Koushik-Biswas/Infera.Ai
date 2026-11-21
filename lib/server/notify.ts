/**
 * In-app notifications (the console's bell).
 *
 *   notify(db, { workspaceId, userIds: "all" | "admins" | string[], type, title, body, link })
 *
 * - "all"    → one shared row (userId null) that every member sees.
 * - "admins" → one row per admin/owner.
 * - ids      → one row per id that is (still) a member of the workspace; others are ignored
 *              (rule 6: a notification never reaches someone outside the workspace).
 *
 * Links must be in-app paths ("/console/..."); anything else is dropped so a notification
 * can never become an open redirect or a `javascript:` link.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./db";
import { memberships, notifications } from "./db/schema";
import { newId } from "./ids";

export type NotifyInput = {
  workspaceId: string;
  userIds: string[] | "all" | "admins";
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
};

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const clean = (s: string, max: number, multiline = false) =>
  clip(
    (multiline ? s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, "") : s.replace(/[\u0000-\u001F\u007F]/g, " ")).trim(),
    max,
  );

/** Only same-app relative paths are kept. */
export function safeLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const l = link.trim();
  if (!l.startsWith("/") || l.startsWith("//") || l.startsWith("/\\") || l.length > 500 || /[\u0000-\u001F\s]/.test(l)) return null;
  return l;
}

/** Inserts notification rows; returns how many were created. */
export async function notify(db: Database, input: NotifyInput): Promise<number> {
  const title = clean(input.title, 200) || "Notification";
  const body = clean(input.body ?? "", 2000, true);
  const link = safeLink(input.link);
  const type = clean(input.type, 60) || "info";
  const now = new Date();

  let recipients: (string | null)[];
  if (input.userIds === "all") recipients = [null];
  else if (input.userIds === "admins") {
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, input.workspaceId), inArray(memberships.role, ["admin", "owner"])));
    recipients = rows.map((r) => r.userId);
  } else {
    const ids = [...new Set(input.userIds.filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64))];
    if (!ids.length) return 0;
    const rows = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, input.workspaceId), inArray(memberships.userId, ids)));
    recipients = rows.map((r) => r.userId);
  }
  if (!recipients.length) return 0;

  await db.insert(notifications).values(recipients.map((userId) => ({ id: newId("ntf"), workspaceId: input.workspaceId, userId, type, title, body, link, createdAt: now })));
  return recipients.length;
}
