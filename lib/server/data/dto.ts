/**
 * Row → DTO mappers for the data API. Message text and previews are sealed at
 * rest (lib/server/data/sealed.ts) and opened here — routes must never return
 * a raw row.
 */
import type { ChannelType, CollectionDTO, ContactDTO, ConversationDTO, EventDTO, MessageDTO, RecordDTO } from "@/lib/shared/types";
import type { CollectionRow, ContactRow, ConversationRow, EventRow, MessageRow, RecordRow } from "../db/schema";
import { openText } from "./sealed";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toMessageDTO(m: Omit<MessageRow, "raw" | "searchTokens"> & Partial<Pick<MessageRow, "raw" | "searchTokens">>): MessageDTO {
  return {
    id: m.id,
    conversationId: m.conversationId,
    channelId: m.channelId,
    contactId: m.contactId,
    externalId: m.externalId,
    direction: m.direction,
    senderName: m.senderName,
    senderHandle: m.senderHandle,
    kind: m.kind,
    text: openText(m.text),
    attachments: m.attachments ?? [],
    sentAt: m.sentAt.toISOString(),
    receivedAt: m.receivedAt.toISOString(),
    status: m.status,
    classification: m.classification ?? null,
    eventId: m.eventId,
  };
}

export function toConversationDTO(c: ConversationRow, channelType: ChannelType): ConversationDTO {
  return {
    id: c.id,
    channelId: c.channelId,
    channelType,
    externalId: c.externalId,
    title: c.title,
    isGroup: c.isGroup,
    contactId: c.contactId,
    lastMessageAt: iso(c.lastMessageAt),
    lastMessagePreview: openText(c.lastMessagePreview),
    unreadCount: c.unreadCount,
    archived: c.archived,
    agentsEnabled: c.agentsEnabled,
  };
}

export function toCollectionDTO(c: CollectionRow, recordCount: number): CollectionDTO {
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    icon: c.icon,
    template: c.template,
    fields: c.fields,
    routing: c.routing,
    matchFields: c.matchFields,
    autopilot: c.autopilot,
    recordCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    archivedAt: iso(c.archivedAt),
  };
}

export function toRecordDTO(r: RecordRow, sourceMessageIds: string[] = []): RecordDTO {
  return {
    id: r.id,
    collectionId: r.collectionId,
    values: r.values,
    fieldMeta: r.fieldMeta ?? {},
    status: r.status,
    contactId: r.contactId,
    conversationId: r.conversationId,
    origin: r.origin,
    version: r.version,
    sourceMessageIds,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: iso(r.deletedAt),
  };
}

export function toContactDTO(c: ContactRow): ContactDTO {
  return {
    id: c.id,
    displayName: c.displayName,
    phone: c.phone,
    email: c.email,
    handles: c.handles ?? {},
    tags: c.tags ?? [],
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toEventDTO(e: EventRow): EventDTO {
  return {
    id: e.id,
    messageId: e.messageId,
    source: e.source,
    status: e.status,
    attempts: e.attempts,
    result: e.result ?? null,
    error: e.error,
    durationMs: e.durationMs,
    model: e.model,
    createdAt: e.createdAt.toISOString(),
    processedAt: iso(e.processedAt),
  };
}
