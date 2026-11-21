/**
 * Database access.
 *
 * - DATABASE_URL set → PostgreSQL via node-postgres (production).
 * - otherwise        → embedded PGlite (real Postgres compiled to WASM), stored in
 *                      PGLITE_DIR (default ./.data/pglite; "memory://" for tests).
 *
 * Usage:   const db = await getDb();
 * Migrations in ./drizzle run automatically on first use (disable with
 * INFERA_AUTO_MIGRATE=0 and run `npm run db:migrate` during deploy instead).
 *
 * Transactions: `db.transaction(async (tx) => ...)`. A transaction object is a
 * `Database` too, so helpers that take `db: Database` accept either.
 *
 * LISTEN/NOTIFY: `listen(channel, cb)` subscribes to `pg_notify` messages. NOTIFY
 * is transactional — a notification sent inside a transaction is delivered only
 * when it commits — which is what realtime updates and job wake-ups rely on.
 */
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export { schema };
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Unlisten = () => Promise<void>;
type State = {
  db: Database;
  kind: "postgres" | "embedded";
  close: () => Promise<void>;
  listen: (channel: string, cb: (payload: string) => void) => Promise<Unlisten>;
};

const g = globalThis as unknown as { __inferaDb?: Promise<State> };

const MIGRATIONS = () => path.join(process.cwd(), "drizzle");
const MIGRATION_LOCK = 72_017_001;
const CHANNEL_RE = /^[a-z_][a-z0-9_]{0,62}$/;

async function connect(): Promise<State> {
  const url = process.env.DATABASE_URL;
  const autoMigrate = process.env.INFERA_AUTO_MIGRATE !== "0";

  if (url) {
    const pg = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (e) => console.error(JSON.stringify({ level: "error", event: "db_pool_error", message: e.message })));
    if (autoMigrate) {
      const { migrate } = await import("drizzle-orm/node-postgres/migrator");
      const client = await pool.connect();
      try {
        // One instance migrates at a time; others wait, then find nothing to do.
        await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
        await migrate(drizzle(client, { schema }), { migrationsFolder: MIGRATIONS() });
      } finally {
        await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
        client.release();
      }
    }

    // One dedicated LISTEN connection per process, shared by all subscribers, reconnecting on failure.
    const subs = new Map<string, Set<(p: string) => void>>();
    let listener: import("pg").Client | null = null;
    let connecting: Promise<import("pg").Client> | null = null;
    let closed = false;
    const ensureListener = (): Promise<import("pg").Client> => {
      if (listener) return Promise.resolve(listener);
      connecting ??= (async () => {
        const c = new pg.Client({ connectionString: url });
        c.on("notification", (n) => {
          for (const cb of subs.get(n.channel) ?? []) {
            try {
              cb(n.payload ?? "");
            } catch {
              /* subscriber errors never break the listener */
            }
          }
        });
        c.on("error", () => {
          listener = null;
          connecting = null;
          c.end().catch(() => {});
          if (!closed && subs.size) setTimeout(() => void ensureListener().catch(() => {}), 2000);
        });
        await c.connect();
        for (const ch of subs.keys()) await c.query(`LISTEN ${ch}`);
        listener = c;
        connecting = null;
        return c;
      })().catch((e) => {
        connecting = null;
        throw e;
      });
      return connecting;
    };

    return {
      db: drizzle(pool, { schema }) as unknown as Database,
      kind: "postgres",
      close: async () => {
        closed = true;
        await listener?.end().catch(() => {});
        await pool.end();
      },
      listen: async (channel, cb) => {
        if (!CHANNEL_RE.test(channel)) throw new Error("Invalid LISTEN channel");
        let set = subs.get(channel);
        const first = !set;
        if (!set) subs.set(channel, (set = new Set()));
        set.add(cb);
        const c = await ensureListener();
        if (first) await c.query(`LISTEN ${channel}`);
        return async () => {
          set.delete(cb);
          if (!set.size) {
            subs.delete(channel);
            await listener?.query(`UNLISTEN ${channel}`).catch(() => {});
          }
        };
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  if (!dir.startsWith("memory://")) {
    const fs = await import("node:fs");
    fs.mkdirSync(dir, { recursive: true });
  }
  const client = await PGlite.create(dir);
  const db = drizzle(client, { schema });
  if (autoMigrate) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db, { migrationsFolder: MIGRATIONS() });
  }
  return {
    db: db as unknown as Database,
    kind: "embedded",
    close: () => client.close(),
    listen: async (channel, cb) => {
      if (!CHANNEL_RE.test(channel)) throw new Error("Invalid LISTEN channel");
      const unsub = await client.listen(channel, cb);
      return () => unsub();
    },
  };
}

export function getDb(): Promise<Database> {
  return getDbState().then((s) => s.db);
}

export function getDbState(): Promise<State> {
  if (!g.__inferaDb) {
    g.__inferaDb = connect().catch((e) => {
      g.__inferaDb = undefined;
      throw e;
    });
  }
  return g.__inferaDb;
}

/** For tests and graceful shutdown. */
export async function closeDb() {
  const p = g.__inferaDb;
  g.__inferaDb = undefined;
  if (p) await (await p).close();
}
