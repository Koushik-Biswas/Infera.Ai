/**
 * Inbound email webhook (Postmark JSON, Mailgun / SendGrid inbound parse forms, or generic JSON).
 * Authenticated with the channel's `inboundSecret`, passed as `?key=` or `X-Infera-Token`
 * (compared in constant time). Body ≤ 25 MB (attachments included).
 */
import { getDb } from "@/lib/server/db";
import { emailToInbound, parseEmailForm, parseEmailJson, verifyEmailToken, type ParsedEmail } from "@/lib/server/channels/adapters/email";
import { decryptSecrets, findChannelByToken } from "@/lib/server/channels/registry";
import { badSignatureResponse, channelRateLimit, EMAIL_MAX_BYTES, ingestForChannel, notFoundResponse, webhookError, webhookHandler, webhookJson } from "@/lib/server/channels/webhook-http";
import { readCappedBytes, tryJson } from "@/lib/server/channels/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOADS = 20;

async function parseBody(raw: Buffer, contentType: string): Promise<ParsedEmail | null | "bad"> {
  const ct = contentType.toLowerCase();
  if (ct.startsWith("application/json") || ct === "") {
    const payload = tryJson(raw.toString("utf8"));
    return payload === undefined ? "bad" : parseEmailJson(payload);
  }
  if (ct.startsWith("multipart/form-data") || ct.startsWith("application/x-www-form-urlencoded")) {
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(raw), { headers: { "content-type": contentType } }).formData();
    } catch {
      return "bad";
    }
    const fields: Record<string, string> = {};
    const uploads: { name: string; mime: string; data: Buffer }[] = [];
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") fields[key] ??= value;
      else if (uploads.length < MAX_UPLOADS) uploads.push({ name: value.name || key, mime: value.type || "application/octet-stream", data: Buffer.from(await value.arrayBuffer()) });
    }
    return parseEmailForm(fields, uploads);
  }
  return "bad";
}

export const POST = webhookHandler<{ token: string }>("email", async (req, { token }) => {
  const db = await getDb();
  const channel = await findChannelByToken(db, "email", token);
  if (!channel) return notFoundResponse();
  const secrets = decryptSecrets(channel);
  const provided = req.headers.get("x-infera-token") ?? new URL(req.url).searchParams.get("key");
  if (!verifyEmailToken(provided, secrets.inboundSecret ?? "")) return badSignatureResponse();
  const raw = await readCappedBytes(req, EMAIL_MAX_BYTES);
  const parsed = await parseBody(raw, req.headers.get("content-type") ?? "");
  if (parsed === "bad") return webhookError(400, "bad_request", "Unsupported or malformed email payload.");
  const limited = await channelRateLimit(channel);
  if (limited) return limited;
  const s = await ingestForChannel(db, channel, parsed ? [emailToInbound(parsed)] : [], "email");
  return webhookJson({ ok: true, ingested: s.ingested, duplicates: s.duplicates });
});
