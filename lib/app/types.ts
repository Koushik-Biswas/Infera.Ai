/** Data model for the Infera app. Everything is stored on-device in IndexedDB. */

export type MsgKind = "text" | "image" | "video" | "audio" | "document" | "contact" | "sticker" | "system" | "deleted";

export type Attachment = {
  /** Key in the `blobs` store. Absent when the export didn't include media. */
  id?: string;
  name: string;
  mime: string;
  size?: number;
};

export type Message = {
  id: string;
  chatId: string;
  at: number; // epoch ms
  sender: string;
  fromMe: boolean;
  text: string;
  kind: MsgKind;
  attachment?: Attachment;
};

export type Chat = {
  id: string;
  name: string;
  isGroup: boolean;
  color: string;
  participants: string[];
  lastAt: number;
  preview: string;
  unread: number;
  pinned?: boolean;
  source: "sample" | "import";
};

export type FieldType = "text" | "number" | "currency" | "status" | "date" | "phone" | "email" | "url" | "location" | "image";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  description: string;
  options?: string[]; // for status
};

export type TemplateId =
  | "orders"
  | "leads"
  | "payments"
  | "products"
  | "tasks"
  | "support"
  | "contacts"
  | "documents"
  | "links"
  | "custom";

export type CellValue = string | number | null;

export type Collection = {
  id: string;
  name: string;
  description: string;
  icon: string;
  template: TemplateId;
  fields: Field[];
  autopilot: boolean;
  /** "all" chats, or a list of chat ids. */
  scope: "all" | string[];
  view: "table" | "gallery";
  /** Which engine fills it. "claude" only takes effect when cloud AI is enabled. */
  engine: "local" | "claude";
  /** Extraction keys of auto rows the user deleted; autopilot never re-creates them. */
  dismissedKeys?: string[];
  createdAt: number;
  updatedAt: number;
};

export type Row = {
  id: string;
  collectionId: string;
  /** Stable extraction key, so re-runs update the same row instead of duplicating it. */
  key?: string;
  values: Record<string, CellValue>;
  /** Field keys the user edited by hand; autopilot never overwrites these. */
  edited?: Record<string, true>;
  chatId?: string;
  sourceIds: string[];
  imageId?: string;
  manual?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Plan = {
  name: string;
  description: string;
  icon: string;
  template: TemplateId;
  fields: Field[];
  scope: "all" | string[];
};

export type AssistantMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  steps?: string[];
  citations?: string[];
  plan?: Plan & { status: "pending" | "accepted" | "rejected"; collectionId?: string };
  collectionId?: string;
  engine?: "local" | "claude";
  error?: boolean;
};

export type Thread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AssistantMsg[];
};

export type Settings = {
  userName: string;
  cloudAI: boolean;
  currency: string;
  dismissedChecklist: boolean;
  installedHintSeen: boolean;
};

export const defaultSettings: Settings = {
  userName: "",
  cloudAI: false,
  currency: "INR",
  dismissedChecklist: false,
  installedHintSeen: false,
};
