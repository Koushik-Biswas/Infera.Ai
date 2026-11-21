/** Internal types shared by the pipeline steps (not part of the public API). */
import type { AttachmentDTO, CellValue, ChannelType, Field, MessageKind } from "@/lib/shared/types";

export type Direction = "inbound" | "outbound";

/** The message being processed, with the facts the extractors may use as metadata. */
export type PipelineMessage = {
  /** null for playground dry runs (nothing is persisted). */
  id: string | null;
  externalId: string | null;
  eventId: string | null;
  workspaceId: string;
  text: string;
  kind: MessageKind;
  direction: Direction;
  senderName: string;
  senderHandle: string | null;
  attachments: AttachmentDTO[];
  sentAt: Date;
  channelId: string | null;
  channelType: ChannelType | null;
  conversationId: string | null;
  conversationTitle: string;
  isGroup: boolean;
  contactId: string | null;
  contact: { displayName: string; phone: string | null; email: string | null } | null;
};

/** An earlier message of the same conversation (rule 17: contextual consistency). */
export type ContextMessage = {
  id: string;
  externalId: string;
  conversationId: string;
  channelId: string;
  text: string;
  senderName: string;
  direction: Direction;
  kind: MessageKind;
  sentAt: Date;
};

/** What a field means, inferred from the template and the field's key/label/type. */
export type FieldRole =
  | "customer"
  | "sender"
  | "shared_name"
  | "phone"
  | "shared_phone"
  | "email"
  | "url"
  | "domain"
  | "link_context"
  | "amount"
  | "quantity"
  | "item"
  | "product"
  | "location"
  | "status"
  | "activity_date"
  | "created_date"
  | "due_date"
  | "method"
  | "reference"
  | "issue"
  | "task"
  | "next_step"
  | "summary"
  | "caption"
  | "file"
  | "file_type"
  | "chat"
  | "image"
  | "size"
  | "color"
  | "generic"
  | "none";

/** One value considered for one field of one collection. */
export type Candidate = {
  field: Field;
  role: FieldRole;
  value: CellValue;
  /** 0..1 */
  confidence: number;
  /** Verbatim snippet of the source message, null for metadata-derived values. */
  evidence: string | null;
  method: "rules" | "ai" | "metadata";
  /** Message the evidence comes from (the processed message, or a context message). */
  messageId: string | null;
  /** Initial status for new records — only used when a record is created. */
  isDefault?: boolean;
};
