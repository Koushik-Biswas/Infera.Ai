/**
 * GET /api/v1/files/:id (viewer / API read) → the attachment bytes, decrypted.
 * Only images, audio, video and PDF render inline; everything else downloads. Never sniffed.
 */
import { and, eq } from "drizzle-orm";
import { notFound, workspaceRoute } from "@/lib/server/api/handler";
import { files } from "@/lib/server/db/schema";
import { openBytes } from "@/lib/server/data/sealed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INLINE = /^(image\/(png|jpeg|gif|webp)|audio\/(ogg|mpeg|mp4|aac|wav|webm)|video\/(mp4|webm)|application\/pdf)$/;

export const GET = workspaceRoute<{ id: string }>({ role: "viewer", scope: "read" }, async (c) => {
  const [f] = await c.db
    .select()
    .from(files)
    .where(and(eq(files.id, c.params.id), eq(files.workspaceId, c.auth.workspaceId)))
    .limit(1);
  if (!f) throw notFound("File");
  const data = openBytes(Buffer.from(f.data));
  const inline = INLINE.test(f.mime);
  const name = encodeURIComponent(f.name.replace(/[\r\n"]/g, "_"));
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": inline ? f.mime : "application/octet-stream",
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
