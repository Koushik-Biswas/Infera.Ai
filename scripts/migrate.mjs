#!/usr/bin/env node
/**
 * Applies SQL migrations from ./drizzle.
 *   DATABASE_URL set → PostgreSQL (takes an advisory lock so parallel deploys are safe)
 *   otherwise        → embedded PGlite at PGLITE_DIR (default ./.data/pglite)
 * Usage: npm run db:migrate
 */
import path from "node:path";
import fs from "node:fs";

const migrationsFolder = path.join(process.cwd(), "drizzle");
const LOCK = 72_017_001;

if (process.env.DATABASE_URL) {
  const { default: pg } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK]);
    await migrate(drizzle(client), { migrationsFolder });
    console.log("Migrations applied (PostgreSQL).");
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK]).catch(() => {});
    await client.end();
  }
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (!dir.startsWith("memory://")) fs.mkdirSync(dir, { recursive: true });
  const client = await PGlite.create(dir);
  await migrate(drizzle(client), { migrationsFolder });
  await client.close();
  console.log(`Migrations applied (embedded PGlite at ${dir}).`);
}
