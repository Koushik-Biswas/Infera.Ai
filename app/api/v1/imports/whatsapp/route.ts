/**
 * POST /api/v1/imports/whatsapp (member / API write) — multipart form:
 *   file      WhatsApp "Export chat" .txt or .zip (≤ 50 MB)
 *   process   "true" (default) | "false" — run classification/extraction on the imported messages
 *   me        optional: your name as it appears in the export (those messages become outbound)
 *   timezone  optional IANA zone of the exporting phone (default: workspace timezone)
 *   channelId optional: an existing whatsapp_export channel (default: the workspace's "WhatsApp imports")
 * → { conversationId, imported, duplicates, queued, skipped, attachmentsStored, channelId, chatName }
 *
 * Re-importing the same export is idempotent (stable message ids) — only new messages are added.
 */
import { ApiError, badRequest, unprocessable, workspaceRoute } from "@/lib/server/api/handler";
import { kickSoon } from "@/lib/server/jobs/kick";
import { defaultWorkspaceSettings } from "@/lib/shared/types";
import { importWhatsAppExport, MAX_IMPORT_BYTES, validTimeZone } from "@/lib/server/channels/whatsapp-import";
import { BodyTooLargeError, readCappedBytes } from "@/lib/server/channels/util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Room for multipart boundaries and the small text fields around the file. */
const FORM_OVERHEAD = 1024 * 1024;

export const POST = workspaceRoute({ role: "member", scope: "write", rateLimit: { limit: 20, windowSec: 3600 } }, async (c) => {
  const contentType = c.req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) throw new ApiError(415, "unsupported_media_type", "Upload the export as multipart/form-data with a `file` field.");
  let raw: Buffer;
  try {
    raw = await readCappedBytes(c.req, MAX_IMPORT_BYTES + FORM_OVERHEAD);
  } catch (e) {
    if (e instanceof BodyTooLargeError) throw new ApiError(413, "too_large", "The export is larger than 50 MB. Export without media, or a shorter chat.");
    throw e;
  }
  let form: FormData;
  try {
    form = await new Response(new Uint8Array(raw), { headers: { "content-type": contentType } }).formData();
  } catch {
    throw badRequest("Could not read the uploaded form.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw unprocessable("Attach the exported chat as `file` (.txt or .zip).", [{ path: "file", message: "required" }]);
  if (file.size === 0) throw unprocessable("The uploaded file is empty.");
  if (file.size > MAX_IMPORT_BYTES) throw new ApiError(413, "too_large", "The export is larger than 50 MB.");
  const name = (file.name || "chat.txt").slice(0, 255);
  if (!/\.(txt|zip)$/i.test(name) && !/^(text\/plain|application\/(x-)?zip(-compressed)?)$/i.test(file.type)) throw unprocessable("Upload the .txt or .zip file WhatsApp produced.");

  const processField = String(form.get("process") ?? "true").trim().toLowerCase();
  if (!["true", "false", "1", "0", ""].includes(processField)) throw unprocessable('process must be "true" or "false".');
  const me = typeof form.get("me") === "string" ? String(form.get("me")).trim().slice(0, 100) : "";
  const tzField = typeof form.get("timezone") === "string" ? String(form.get("timezone")).trim() : "";
  if (tzField && !validTimeZone(tzField)) throw unprocessable("timezone must be an IANA time zone such as Asia/Kolkata.");
  const channelId = typeof form.get("channelId") === "string" ? String(form.get("channelId")).trim() : "";

  const ws = await c.db.query.workspaces.findFirst({ where: (w, { eq }) => eq(w.id, c.auth.workspaceId) });
  const timezone = validTimeZone(tzField) ?? validTimeZone(ws?.settings?.timezone) ?? defaultWorkspaceSettings.timezone;

  const result = await importWhatsAppExport(c.db, {
    workspaceId: c.auth.workspaceId,
    actor: c.auth.actor,
    fileName: name,
    bytes: Buffer.from(await file.arrayBuffer()),
    me: me || null,
    process: processField !== "false" && processField !== "0",
    timezone,
    channelId: channelId || null,
  });
  if (result.queued) kickSoon(10);
  return result;
});
