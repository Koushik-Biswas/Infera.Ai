/**
 * Record helpers for the data API: source message ids and full provenance
 * (source messages decrypted for display).
 */
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { RecordSourceDTO } from "@/lib/shared/types";
import type { Database } from "../db";
import { messages, recordSources } from "../db/schema";
import { openText } from "./sealed";

/** message ids each record was extracted from */
export async function sourceIdsFor(db: Database, recordIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!recordIds.length) return out;
  const rows = await db
    .selectDistinct({ recordId: recordSources.recordId, messageId: recordSources.messageId })
    .from(recordSources)
    .where(and(inArray(recordSources.recordId, recordIds), isNotNull(recordSources.messageId)));
  for (const r of rows) {
    const list = out.get(r.recordId) ?? [];
    if (r.messageId && list.length < 20) list.push(r.messageId);
    out.set(r.recordId, list);
  }
  return out;
}


/** Every source of a record with the message it came from (newest first). */
export async function sourcesOf(db: Database, workspaceId: string, recordId: string): Promise<RecordSourceDTO[]> {
  const rows = await db
    .select({
      messageId: recordSources.messageId,
      fieldKey: recordSources.fieldKey,
      evidence: recordSources.evidence,
      confidence: recordSources.confidence,
      text: messages.text,
      senderName: messages.senderName,
      direction: messages.direction,
      sentAt: messages.sentAt,
      conversationId: messages.conversationId,
    })
    .from(recordSources)
    .leftJoin(messages, and(eq(messages.id, recordSources.messageId), eq(messages.workspaceId, workspaceId)))
    .where(and(eq(recordSources.recordId, recordId), eq(recordSources.workspaceId, workspaceId)))
    .orderBy(desc(recordSources.id))
    .limit(100);
  return rows
    .filter((r) => r.messageId)
    .map((r) => ({
      messageId: r.messageId!,
      fieldKey: r.fieldKey,
      evidence: r.evidence,
      confidence: r.confidence,
      message: r.sentAt && r.conversationId ? { text: openText(r.text), senderName: r.direction === "outbound" ? "You" : (r.senderName ?? ""), sentAt: r.sentAt.toISOString(), conversationId: r.conversationId } : null,
    }));
}
