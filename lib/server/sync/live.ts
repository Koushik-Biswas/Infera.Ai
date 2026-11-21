/**
 * In-process registry of live persistent connections that can send messages.
 *
 * A persistent connector (e.g. the WhatsApp linked device) runs on exactly one
 * server instance — the lease holder. It registers a sender here while its
 * socket is open, and `sendOutbound()` looks it up. Stored on globalThis so
 * route handlers, jobs and the sync manager share one map in the process.
 */
export type LiveSender = {
  /** Sends plain text to a provider chat id; resolves with the provider message id. */
  sendText(to: string, text: string, opts?: { subject?: string; inReplyTo?: string; references?: string[] }): Promise<{ providerMessageId: string | null }>;
};

const g = globalThis as unknown as { __inferaLiveSenders?: Map<string, LiveSender> };
const senders = (g.__inferaLiveSenders ??= new Map());

/** Registers a sender for a channel; returns an unregister function (no-op if replaced since). */
export function registerLiveSender(channelId: string, sender: LiveSender): () => void {
  senders.set(channelId, sender);
  return () => {
    if (senders.get(channelId) === sender) senders.delete(channelId);
  };
}

export function getLiveSender(channelId: string): LiveSender | null {
  return senders.get(channelId) ?? null;
}
