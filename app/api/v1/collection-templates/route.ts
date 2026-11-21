/** GET /api/v1/collection-templates (viewer / API read) → { items: CollectionPlanDTO[] } */
import { workspaceRoute } from "@/lib/server/api/handler";
import { serverTemplates } from "@/lib/server/templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = workspaceRoute({ role: "viewer", scope: "read" }, async () => ({ items: serverTemplates() }));
