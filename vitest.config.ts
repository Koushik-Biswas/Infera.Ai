import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Each test file gets its own in-memory Postgres (PGlite) — no Docker needed.
    env: {
      PGLITE_DIR: "memory://",
      INFERA_WORKER: "off",
      ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000001",
      APP_URL: "http://localhost:3000",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
    },
    pool: "forks",
    // Each worker runs its own embedded Postgres (~150 MB). One worker keeps low-RAM machines stable;
    // CI can raise it: VITEST_MAX_WORKERS=4 npm test
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 1),
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
