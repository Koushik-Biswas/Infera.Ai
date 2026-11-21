import Anthropic from "@anthropic-ai/sdk";
import { cleanText, guardJsonPost, json, log } from "@/lib/server/http";
import { askQuestion, ClaudeError, claudeConfigured, extractRows, MODEL, planCollection } from "@/lib/server/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ROUTE = "ai";
const MAX_BYTES = 400 * 1024;

/** Lets the app know whether cloud AI can be offered. Exposes no secrets. */
export function GET() {
  return json({ available: claudeConfigured(), model: claudeConfigured() ? MODEL : null });
}

export async function POST(request: Request) {
  if (!claudeConfigured()) return json({ error: "Cloud AI isn't set up on this server." }, 503);
  const g = await guardJsonPost(request, { route: ROUTE, limit: 40, windowSec: 600, maxBytes: MAX_BYTES });
  if (!g.ok) return g.response;
  const body = g.body;
  const action = cleanText(body.action, 20);
  const started = Date.now();

  try {
    if (action === "plan") {
      const prompt = cleanText(body.prompt, 1000, { multiline: true });
      if (!prompt) return json({ error: "Describe the collection you want." }, 422);
      const plan = await planCollection(prompt, cleanText(body.sample, 60_000, { multiline: true }));
      log("info", "ai_ok", { route: ROUTE, action, ms: Date.now() - started });
      return json({ plan });
    }

    if (action === "extract") {
      const fields = Array.isArray(body.fields) ? body.fields.slice(0, 20) : [];
      const clean = fields
        .map((f) => {
          const o = (f ?? {}) as Record<string, unknown>;
          return {
            key: cleanText(o.key, 40),
            label: cleanText(o.label, 60),
            type: cleanText(o.type, 20),
            description: cleanText(o.description, 300),
            options: Array.isArray(o.options) ? o.options.slice(0, 12).map((x) => cleanText(x, 40)).filter(Boolean) : [],
          };
        })
        .filter((f) => f.key && f.label);
      const transcript = cleanText(body.transcript, MAX_BYTES, { multiline: true });
      if (!clean.length || !transcript) return json({ error: "Nothing to extract." }, 422);
      const result = await extractRows({
        name: cleanText(body.name, 80) || "Collection",
        description: cleanText(body.description, 300),
        fields: clean,
        transcript,
      });
      log("info", "ai_ok", { route: ROUTE, action, ms: Date.now() - started, rows: result.rows.length });
      return json(result);
    }

    if (action === "ask") {
      const question = cleanText(body.question, 1000, { multiline: true });
      if (!question) return json({ error: "Ask a question." }, 422);
      const result = await askQuestion(
        question,
        cleanText(body.context, 300_000, { multiline: true }),
        cleanText(body.collections, 60_000, { multiline: true }),
      );
      log("info", "ai_ok", { route: ROUTE, action, ms: Date.now() - started });
      return json(result);
    }

    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e instanceof ClaudeError) return json({ error: e.message }, e.status);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "Cloud AI is busy. Try again in a minute." }, 429);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      log("error", "ai_auth_failed", { route: ROUTE });
      return json({ error: "Cloud AI isn't set up correctly on this server." }, 503);
    }
    if (e instanceof Anthropic.APIError) {
      log("error", "ai_api_error", { route: ROUTE, action, status: e.status });
      return json({ error: "Cloud AI failed. Your on-device assistant still works." }, 502);
    }
    log("error", "ai_failed", { route: ROUTE, action, message: e instanceof Error ? e.message : String(e) });
    return json({ error: "Cloud AI failed. Your on-device assistant still works." }, 502);
  }
}
