/**
 * Normalised inbound message — every channel adapter converts its provider
 * payload into this shape and hands it to `ingestInboundMessage()`.
 */
import type { Actor, MessageKind, Source } from "@/lib/shared/types";

export type InboundAttachment = {
  name: string;
  mime: string;
  size?: number | null;
  /** Provider media id (fetched later by the adapter) or a URL. */
  providerId?: string | null;
  url?: string | null;
  /** Bytes when already available (exports, email attachments). */
  data?: Buffer | null;
};

export type InboundMessage = {
  workspaceId: string;
  channelId: string;
  /** Provider message id. Duplicate (channelId, externalId) pairs are dropped. */
  externalId: string;
  direction?: "inbound" | "outbound";
  conversation: { externalId: string; title?: string | null; isGroup?: boolean };
  sender: { externalId?: string | null; name?: string | null; phone?: string | null; email?: string | null; isMe?: boolean };
  kind?: MessageKind;
  text: string;
  attachments?: InboundAttachment[];
  sentAt: Date;
  replyToExternalId?: string | null;
  /** Trimmed provider payload for debugging (no secrets). */
  raw?: unknown;
  /** Processing priority (default 50; bulk imports use 200). */
  priority?: number;
  /** Skip AI/extraction for this message (e.g. historical import with processing off). */
  skipProcessing?: boolean;
  /**
   * Historical import: don't bump unread counters and don't emit `message.received`
   * (so importing 5,000 old messages doesn't fire 5,000 automations). The importer also records
   * usage / channel activity once for the whole batch instead of per message.
   */
  historical?: boolean;
  /** Who caused the ingestion (API key, user for test messages). Default: the channel (system actor). */
  actor?: Actor;
  /** Override the event `source` (API clients forwarding e.g. WhatsApp traffic). Default: derived from the channel type. */
  source?: Source;
  /** Run the `process_message` job no earlier than this (used when the caller processes inline first). */
  processAt?: Date;
};

/** What a pure adapter `parse*()` produces: an InboundMessage minus the routing ids the webhook route adds. */
export type ParsedInbound = Omit<InboundMessage, "workspaceId" | "channelId">;

export type IngestResult = {
  messageId: string;
  eventId: string | null;
  conversationId: string;
  duplicate: boolean;
  /** Contact the message is linked to (sender for inbound 1:1, conversation contact for outbound). */
  contactId?: string | null;
};
