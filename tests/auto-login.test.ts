import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { memberships, users } from "@/lib/server/db/schema";
import { verifyPassword } from "@/lib/server/crypto";
import { GET as auto } from "@/app/api/auth/auto/route";
import { GET as me } from "@/app/api/auth/me/route";
import { call } from "./helpers";

const go = (path: string, cookie?: string) => auto(new Request(`http://localhost:3000${path}`, { headers: cookie ? { cookie, host: "localhost:3000" } : { host: "localhost:3000" } }));
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";

afterEach(() => {
  delete process.env.INFERA_AUTO_LOGIN;
});

describe("single-user auto sign-in", () => {
  it("creates one owner with a workspace, signs in, and reuses it", async () => {
    const db = await getDb();
    const r1 = await go("/api/auth/auto");
    expect(r1.status).toBe(303);
    expect(r1.headers.get("location")).toBe("http://localhost:3000/console/connect");
    const cookie = cookieOf(r1);
    expect(cookie).toMatch(/infera_session=/);

    const [owner] = await db.select().from(users).where(eq(users.email, "owner@infera.local"));
    expect(owner).toBeTruthy();
    expect(await verifyPassword("anything", owner.passwordHash)).toBe(false); // no password sign-in
    const ms = await db.select().from(memberships).where(eq(memberships.userId, owner.id));
    expect(ms).toHaveLength(1);
    expect(ms[0].role).toBe("owner");

    const m = await call(me, { url: "/api/auth/me", headers: { cookie } });
    expect(m.json).toMatchObject({ user: { email: "owner@infera.local" }, autoLogin: true, role: "owner" });

    // Already signed in: just redirect.
    const r2 = await go("/api/auth/auto?next=/console/inbox", cookie);
    expect(r2.headers.get("location")).toBe("http://localhost:3000/console/inbox");
    expect(r2.headers.get("set-cookie")).toBeNull();

    // A new browser: same owner, no duplicate account.
    const r3 = await go("/api/auth/auto");
    expect(cookieOf(r3)).not.toBe(cookie);
    expect(await db.select().from(users).where(eq(users.email, "owner@infera.local"))).toHaveLength(1);
  });

  it("only redirects to same-site paths and falls back to /login when off", async () => {
    expect((await go("/api/auth/auto?next=//evil.example/x")).headers.get("location")).toBe("http://localhost:3000/console/connect");
    expect((await go("/api/auth/auto?next=/login")).headers.get("location")).toBe("http://localhost:3000/console/connect");
    process.env.INFERA_AUTO_LOGIN = "0";
    const off = await go("/api/auth/auto?next=/console/inbox");
    expect(off.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fconsole%2Finbox");
    expect(off.headers.get("set-cookie")).toBeNull();
  });
});
