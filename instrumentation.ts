/**
 * Runs once when the Next.js server starts. Node-only startup (job worker,
 * scheduler) lives in lib/server/boot.ts and is imported only for the Node.js
 * runtime, so the Edge bundle never sees Node APIs.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { boot } = await import("./lib/server/boot");
  await boot();
}
