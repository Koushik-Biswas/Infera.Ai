/**
 * Persistent connector implementations, loaded lazily so the heavy client
 * libraries (baileys, teleproto, imapflow) are only imported on the server
 * instance that actually runs a channel of that type — never in request paths.
 */
import type { PersistentChannelType } from "@/lib/shared/types";
import type { ConnectorFactory } from "./types";

export const connectorLoaders: Record<PersistentChannelType, () => Promise<ConnectorFactory>> = {
  whatsapp_web: () => import("./connectors/whatsapp-web").then((m) => m.createConnector),
  telegram_user: () => import("./connectors/telegram-user").then((m) => m.createConnector),
  email_imap: () => import("./connectors/email-imap").then((m) => m.createConnector),
};
