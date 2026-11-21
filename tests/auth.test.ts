import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/server/db";
import { apiKeys, auditLog, collections, invitations, memberships, sessions, users, workspaces } from "@/lib/server/db/schema";
import { sessionCookieName } from "@/lib/server/auth/session";
import { canChangeRole, canRemoveMember } from "@/lib/server/auth/members";
import { POST as signupPOST } from "@/app/api/auth/signup/route";
import { POST as loginPOST } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { GET as meGET } from "@/app/api/auth/me/route";
import { POST as switchPOST } from "@/app/api/auth/switch-workspace/route";
import { POST as passwordPOST } from "@/app/api/auth/password/route";
import { POST as workspacesPOST } from "@/app/api/workspaces/route";
import { DELETE as workspaceDELETE, GET as workspaceGET, PATCH as workspacePATCH } from "@/app/api/v1/workspace/route";
import { GET as membersGET } from "@/app/api/v1/members/route";
import { DELETE as memberDELETE, PATCH as memberPATCH } from "@/app/api/v1/members/[userId]/route";
import { GET as invitationsGET, POST as invitationsPOST } from "@/app/api/v1/invitations/route";
import { DELETE as invitationDELETE } from "@/app/api/v1/invitations/[id]/route";
import { GET as publicInviteGET } from "@/app/api/invitations/[token]/route";
import { POST as acceptPOST } from "@/app/api/invitations/[token]/accept/route";
import { GET as apiKeysGET, POST as apiKeysPOST } from "@/app/api/v1/api-keys/route";
import { DELETE as apiKeyDELETE } from "@/app/api/v1/api-keys/[id]/route";
import { addMember, call, createTestWorkspace } from "./helpers";

const PASSWORD = "correct horse battery";

/** Distinct client IPs so per-IP limits of public routes don't interfere between tests. */
let ipCounter = 0;
const nextIp = () => {
  ipCounter++;
  return `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
};
let emailCounter = 0;
const uniqueEmail = (tag: string) => `${tag}${++emailCounter}@example.com`;

const cookieFrom = (res: { headers: Headers }) => {
  const raw = res.headers.get("set-cookie");
  expect(raw).toBeTruthy();
  return raw!.split(";")[0];
};

async function signup(email: string, extra: Record<string, unknown> = {}) {
  return call(signupPOST, { url: "/api/auth/signup", body: { name: "Asha Rao", email, password: PASSWORD, ...extra }, headers: { "x-forwarded-for": nextIp() } });
}

async function login(email: string, password: string, ip = nextIp()) {
  return call(loginPOST, { url: "/api/auth/login", body: { email, password }, headers: { "x-forwarded-for": ip } });
}

const me = (cookie?: string) => call(meGET, { url: "/api/auth/me", cookie });

const originalSignups = process.env.SIGNUPS_ENABLED;
afterEach(() => {
  if (originalSignups === undefined) delete process.env.SIGNUPS_ENABLED;
  else process.env.SIGNUPS_ENABLED = originalSignups;
});

describe("signup, session, logout", () => {
  it("signs up → me → logout → me 401", async () => {
    const db = await getDb();
    const email = uniqueEmail("Asha.");
    const res = await signup(email.toUpperCase(), { workspaceName: "Asha Textiles" });
    expect(res.status).toBe(201);
    expect(res.json.user.email).toBe(email.toLowerCase());
    expect(res.json.user).not.toHaveProperty("passwordHash");
    expect(res.json.role).toBe("owner");
    expect(res.json.workspace.name).toBe("Asha Textiles");
    expect(res.json.workspace.slug).toBe("asha-textiles");
    expect(res.json.workspace.settings.aiMode).toBe("assist");
    expect(res.json.workspaces).toEqual([{ id: res.json.workspace.id, name: "Asha Textiles", slug: "asha-textiles", role: "owner" }]);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const cookie = cookieFrom(res);
    expect(cookie.startsWith(`${sessionCookieName()}=`)).toBe(true);

    // Default collections + audit entry.
    const cols = await db.select().from(collections).where(eq(collections.workspaceId, res.json.workspace.id));
    expect(cols.map((c) => c.template).sort()).toEqual(["leads", "orders", "payments", "support", "tasks"]);
    expect(cols.every((c) => c.autopilot && c.fields.length > 0 && c.routing.categories.length > 0)).toBe(true);
    const audits = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, res.json.workspace.id), eq(auditLog.action, "workspace.create")));
    expect(audits).toHaveLength(1);

    // Stored password is a scrypt hash, never the password.
    const [u] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
    expect(u.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(u.passwordHash).not.toContain(PASSWORD);

    const m = await me(cookie);
    expect(m.status).toBe(200);
    expect(m.json.user.id).toBe(res.json.user.id);
    expect(m.json.workspace.id).toBe(res.json.workspace.id);

    const out = await call(logoutPOST, { url: "/api/auth/logout", method: "POST", cookie });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await me(cookie)).status).toBe(401);
    // Logging out without a session is fine too.
    expect((await call(logoutPOST, { url: "/api/auth/logout", method: "POST" })).status).toBe(204);
  });

  it("validates input, rejects duplicates and honours SIGNUPS_ENABLED", async () => {
    const email = uniqueEmail("dup");
    expect((await signup(email, { password: "short" })).status).toBe(422);
    expect((await signup(email, { password: email.toUpperCase() })).status).toBe(422);
    expect((await signup("not-an-email")).status).toBe(422);
    expect((await signup(email, { name: "   " })).status).toBe(422);

    const first = await signup(email);
    expect(first.status).toBe(201);
    expect(first.json.workspace.name).toBe("Asha Rao's workspace");
    const again = await signup(email.toUpperCase());
    expect(again.status).toBe(409);
    expect(again.json.error.message).not.toContain(email);

    process.env.SIGNUPS_ENABLED = "false";
    const closed = await signup(uniqueEmail("closed"));
    expect(closed.status).toBe(403);
    expect(closed.json.error.code).toBe("signups_disabled");
  });

  it("rejects cross-site signup attempts", async () => {
    const res = await call(signupPOST, { url: "/api/auth/signup", body: { name: "X", email: uniqueEmail("csrf"), password: PASSWORD }, headers: { origin: "https://evil.example", "x-forwarded-for": nextIp() } });
    expect(res.status).toBe(403);
  });

  it("rate limits signups per IP", async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await call(signupPOST, { url: "/api/auth/signup", body: { name: "Bot", email: "x", password: PASSWORD }, headers: { "x-forwarded-for": ip } });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5).every((s) => s === 422)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe("login", () => {
  it("rejects wrong passwords with 401, signs in, and rate limits per email and per IP", async () => {
    const db = await getDb();
    const email = uniqueEmail("login");
    const s = await signup(email);
    expect(s.status).toBe(201);

    const wrong = await login(email, "wrong password!!");
    expect(wrong.status).toBe(401);
    expect(wrong.json.error.message).toBe("Incorrect email or password.");
    expect((await login(uniqueEmail("nobody"), PASSWORD)).status).toBe(401);

    const ok = await login(email.toUpperCase(), PASSWORD);
    expect(ok.status).toBe(200);
    expect(ok.json.workspace.id).toBe(s.json.workspace.id);
    expect(ok.json.role).toBe("owner");
    const cookie = cookieFrom(ok);
    expect((await me(cookie)).status).toBe(200);
    const [u] = await db.select().from(users).where(eq(users.email, email));
    expect(u.lastLoginAt).toBeInstanceOf(Date);

    // Per-email limit (5 / 15 min) applies across IPs.
    let limited = false;
    for (let i = 0; i < 6 && !limited; i++) limited = (await login(email, "wrong password!!")).status === 429;
    expect(limited).toBe(true);
    // Even the right password is refused while limited.
    expect((await login(email, PASSWORD)).status).toBe(429);

    // Per-IP limit (10 / min) applies across emails.
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await login(uniqueEmail("spray"), PASSWORD, ip)).status);
    expect(statuses.slice(0, 10).every((x) => x === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("password change", () => {
  it("verifies the current password and revokes other sessions", async () => {
    const db = await getDb();
    const email = uniqueEmail("pw");
    const a = await signup(email);
    const cookieA = cookieFrom(a);
    const cookieB = cookieFrom(await login(email, PASSWORD));

    const change = (body: Record<string, unknown>) => call(passwordPOST, { url: "/api/auth/password", body, cookie: cookieA });
    const bad = await change({ currentPassword: "nope nope nope", newPassword: "a brand new passphrase" });
    expect(bad.status).toBe(403);
    expect(bad.json.error.code).toBe("invalid_password");
    expect((await change({ currentPassword: PASSWORD, newPassword: "short" })).status).toBe(422);
    expect((await change({ currentPassword: PASSWORD, newPassword: PASSWORD })).status).toBe(422);
    expect((await change({ currentPassword: PASSWORD, newPassword: email })).status).toBe(422);

    const ok = await change({ currentPassword: PASSWORD, newPassword: "a brand new passphrase" });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ ok: true, revokedSessions: 1 });
    expect((await me(cookieB)).status).toBe(401);
    expect((await me(cookieA)).status).toBe(200);

    expect((await login(email, PASSWORD)).status).toBe(401);
    expect((await login(email, "a brand new passphrase")).status).toBe(200);

    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.action, "user.password_change"), eq(auditLog.targetId, a.json.user.id)));
    expect(entry.workspaceId).toBeNull();
    expect(JSON.stringify(entry)).not.toContain("scrypt");
  });
});

describe("workspaces", () => {
  it("creates workspaces, switches between them, and falls back after deletion", async () => {
    const db = await getDb();
    const s = await signup(uniqueEmail("multi"));
    const cookie = cookieFrom(s);
    const ws1 = s.json.workspace.id as string;

    const created = await call(workspacesPOST, { url: "/api/workspaces", body: { name: "Acme Traders!" }, cookie });
    expect(created.status).toBe(201);
    expect(created.json.slug).toBe("acme-traders");
    expect(created.json.settings.currency).toBe("INR");
    const ws2 = created.json.id as string;
    expect((await db.select().from(collections).where(eq(collections.workspaceId, ws2))).length).toBe(5);

    // Same name → unique slug with a suffix.
    const dupName = await call(workspacesPOST, { url: "/api/workspaces", body: { name: "Acme Traders" }, cookie });
    expect(dupName.status).toBe(201);
    expect(dupName.json.slug).toMatch(/^acme-traders-[0-9a-z]{6}$/);
    expect((await call(workspacesPOST, { url: "/api/workspaces", body: { name: "  " }, cookie })).status).toBe(422);

    let m = await me(cookie);
    expect(m.json.workspace.id).toBe(dupName.json.id);
    expect(m.json.workspaces).toHaveLength(3);

    const sw = await call(switchPOST, { url: "/api/auth/switch-workspace", body: { workspaceId: ws2 }, cookie });
    expect(sw.status).toBe(200);
    expect(sw.json.workspace.id).toBe(ws2);
    expect((await call(workspaceGET, { url: "/api/v1/workspace", cookie })).json.id).toBe(ws2);

    // Not a member → 404 (existence not revealed).
    const stranger = await createTestWorkspace();
    expect((await call(switchPOST, { url: "/api/auth/switch-workspace", body: { workspaceId: stranger.workspaceId }, cookie })).status).toBe(404);
    expect((await call(switchPOST, { url: "/api/auth/switch-workspace", body: { workspaceId: "ws_doesnotexist" }, cookie })).status).toBe(404);

    // Delete the active workspace → /me falls back to the most recently joined remaining one.
    const del = await call(workspaceDELETE, { url: "/api/v1/workspace", method: "DELETE", body: { confirm: "acme-traders" }, cookie });
    expect(del.status).toBe(204);
    m = await me(cookie);
    expect(m.json.workspace.id).toBe(dupName.json.id);
    expect(m.json.workspaces.map((w: { id: string }) => w.id).sort()).toEqual([ws1, dupName.json.id].sort());
    expect(m.json.workspaces.find((w: { id: string }) => w.id === ws2)).toBeUndefined();

    // Unauthenticated
    expect((await call(workspacesPOST, { url: "/api/workspaces", body: { name: "x" } })).status).toBe(401);
  });

  it("validates settings, enforces roles and audits changes", async () => {
    const db = await getDb();
    const owner = await createTestWorkspace();
    const admin = await addMember(owner.workspaceId, "admin");
    const viewer = await addMember(owner.workspaceId, "viewer");
    const patch = (cookie: string, body: unknown) => call(workspacePATCH, { url: "/api/v1/workspace", method: "PATCH", body, cookie });

    const got = await call(workspaceGET, { url: "/api/v1/workspace", cookie: viewer.cookie });
    expect(got.status).toBe(200);
    expect(got.json.id).toBe(owner.workspaceId);
    expect(got.json.settings.aiMode).toBe("off");
    expect((await call(workspaceGET, { url: "/api/v1/workspace" })).status).toBe(401);

    expect((await patch(viewer.cookie, { name: "Mine now" })).status).toBe(403);
    expect((await call(workspacePATCH, { url: "/api/v1/workspace", method: "PATCH", body: { name: "Key" }, apiKey: owner.apiKey })).status).toBe(403);

    // Cross-field rule after merge: review threshold above auto-apply (0.8).
    const cross = await patch(admin.cookie, { settings: { reviewThreshold: 0.9 } });
    expect(cross.status).toBe(422);
    expect(cross.json.error.message).toContain("reviewThreshold");
    expect((await patch(admin.cookie, { settings: { timezone: "Mars/Olympus_Mons" } })).status).toBe(422);
    expect((await patch(admin.cookie, { settings: { currency: "RUPEES" } })).status).toBe(422);
    expect((await patch(admin.cookie, { settings: { retentionDays: 0 } })).status).toBe(422);
    expect((await patch(admin.cookie, { settings: { retentionDays: 10.5 } })).status).toBe(422);
    expect((await patch(admin.cookie, { settings: { autoApplyThreshold: 1.5 } })).status).toBe(422);
    expect((await patch(admin.cookie, { settings: { aiMode: "max" } })).status).toBe(422);
    expect((await patch(admin.cookie, { settings: { unknownSetting: true } })).status).toBe(422);
    expect((await patch(admin.cookie, { name: "" })).status).toBe(422);

    const ok = await patch(admin.cookie, {
      name: "Rao Exports",
      settings: { currency: "usd", timezone: "America/New_York", defaultCountryCode: "+1", aiMode: "full", autoApplyThreshold: 0.95, reviewThreshold: 0.9, retentionDays: 90, allowExternalActions: true, redactPII: false },
    });
    expect(ok.status).toBe(200);
    expect(ok.json.name).toBe("Rao Exports");
    expect(ok.json.settings).toEqual({ currency: "USD", timezone: "America/New_York", defaultCountryCode: "+1", aiMode: "full", redactPII: false, autoApplyThreshold: 0.95, reviewThreshold: 0.9, retentionDays: 90, allowExternalActions: true });
    expect((await patch(admin.cookie, { settings: { defaultCountryCode: "91" } })).status).toBe(422);
    // Partial update keeps the rest.
    const partial = await patch(admin.cookie, { settings: { retentionDays: null } });
    expect(partial.json.settings.retentionDays).toBeNull();
    expect(partial.json.settings.currency).toBe("USD");

    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, owner.workspaceId), eq(auditLog.action, "workspace.settings_update"))).orderBy(auditLog.id);
    expect(entry.before).toMatchObject({ name: expect.any(String), currency: "INR" });
    expect(entry.after).toMatchObject({ name: "Rao Exports", currency: "USD", retentionDays: 90 });
    expect(entry.actorId).toBe(admin.userId);

    // API keys with "read" can read the workspace.
    expect((await call(workspaceGET, { url: "/api/v1/workspace", apiKey: owner.apiKey })).json.name).toBe("Rao Exports");

    // Deletion: owner only, slug confirmation, audit survives the cascade.
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, owner.workspaceId));
    expect((await call(workspaceDELETE, { url: "/api/v1/workspace", method: "DELETE", body: { confirm: ws.slug }, cookie: admin.cookie })).status).toBe(403);
    expect((await call(workspaceDELETE, { url: "/api/v1/workspace", method: "DELETE", body: { confirm: "nope" }, cookie: owner.cookie })).status).toBe(422);
    expect((await call(workspaceDELETE, { url: `/api/v1/workspace?confirm=${ws.slug}`, method: "DELETE", cookie: owner.cookie })).status).toBe(204);
    expect(await db.select().from(workspaces).where(eq(workspaces.id, owner.workspaceId))).toHaveLength(0);
    expect(await db.select().from(memberships).where(eq(memberships.workspaceId, owner.workspaceId))).toHaveLength(0);
    const [del] = await db.select().from(auditLog).where(and(eq(auditLog.action, "workspace.delete"), eq(auditLog.targetId, owner.workspaceId)));
    expect(del.workspaceId).toBeNull();
    const ownerSessions = await db.select().from(sessions).where(eq(sessions.userId, owner.userId));
    expect(ownerSessions.every((s) => s.workspaceId === null)).toBe(true);
    const after = await call(workspaceGET, { url: "/api/v1/workspace", cookie: owner.cookie });
    expect(after.status).toBe(409);
    expect((await call(workspaceGET, { url: "/api/v1/workspace", apiKey: owner.apiKey })).status).toBe(401);
  });
});

describe("members", () => {
  it("encodes the role rules", () => {
    expect(canChangeRole("owner", "owner", "viewer")).toBe(true);
    expect(canChangeRole("admin", "member", "viewer")).toBe(true);
    expect(canChangeRole("admin", "viewer", "member")).toBe(true);
    expect(canChangeRole("admin", "member", "admin")).toBe(false);
    expect(canChangeRole("admin", "admin", "member")).toBe(false);
    expect(canChangeRole("admin", "owner", "member")).toBe(false);
    expect(canChangeRole("member", "viewer", "member")).toBe(false);
    expect(canRemoveMember("viewer", "viewer", true)).toBe(true);
    expect(canRemoveMember("admin", "admin", false)).toBe(false);
    expect(canRemoveMember("admin", "member", false)).toBe(true);
  });

  it("lists members, enforces role rules and protects the last owner", async () => {
    const db = await getDb();
    const owner = await createTestWorkspace();
    const admin = await addMember(owner.workspaceId, "admin");
    const member = await addMember(owner.workspaceId, "member");
    const viewer = await addMember(owner.workspaceId, "viewer");
    const other = await createTestWorkspace();
    const setRole = (cookie: string, userId: string, role: string) => call(memberPATCH, { url: `/api/v1/members/${userId}`, method: "PATCH", body: { role }, cookie, params: { userId } });
    const remove = (cookie: string, userId: string) => call(memberDELETE, { url: `/api/v1/members/${userId}`, method: "DELETE", cookie, params: { userId } });

    const list = await call(membersGET, { url: "/api/v1/members", cookie: viewer.cookie });
    expect(list.status).toBe(200);
    expect(list.json.items).toHaveLength(4);
    expect(list.json.items[0]).toMatchObject({ userId: owner.userId, role: "owner", email: owner.email });
    expect(Object.keys(list.json.items[0]).sort()).toEqual(["email", "joinedAt", "name", "role", "userId"]);
    expect((await call(membersGET, { url: "/api/v1/members", apiKey: owner.apiKey })).status).toBe(403);

    // Admin: member ⇄ viewer only.
    const demoted = await setRole(admin.cookie, member.userId, "viewer");
    expect(demoted.status).toBe(200);
    expect(demoted.json).toMatchObject({ userId: member.userId, role: "viewer" });
    expect((await setRole(admin.cookie, member.userId, "member")).json.role).toBe("member");
    expect((await setRole(admin.cookie, member.userId, "admin")).status).toBe(403);
    expect((await setRole(admin.cookie, owner.userId, "member")).status).toBe(403);
    expect((await setRole(admin.cookie, admin.userId, "member")).status).toBe(403);
    expect((await setRole(member.cookie, viewer.userId, "member")).status).toBe(403);
    expect((await setRole(admin.cookie, member.userId, "superuser")).status).toBe(422);

    // Last owner can't step down or leave.
    const lastOwner = await setRole(owner.cookie, owner.userId, "admin");
    expect(lastOwner.status).toBe(409);
    expect(lastOwner.json.error.code).toBe("last_owner");
    expect((await remove(owner.cookie, owner.userId)).status).toBe(409);

    // Owner promotes the admin to owner; now the original owner can step down.
    expect((await setRole(owner.cookie, admin.userId, "owner")).json.role).toBe("owner");
    expect((await setRole(owner.cookie, owner.userId, "admin")).json.role).toBe("admin");
    expect((await setRole(owner.cookie, admin.userId, "member")).status).toBe(403); // now only an admin

    // Tenancy: another workspace's user id → 404.
    expect((await setRole(admin.cookie, other.userId, "viewer")).status).toBe(404);
    expect((await remove(admin.cookie, other.userId)).status).toBe(404);

    // Removal rules.
    expect((await remove(viewer.cookie, member.userId)).status).toBe(403);
    expect((await remove(owner.cookie, admin.userId)).status).toBe(403); // owner.* is now an admin, target is an owner
    expect((await remove(owner.cookie, member.userId)).status).toBe(204);
    const memberSessions = await db.select().from(sessions).where(eq(sessions.userId, member.userId));
    expect(memberSessions.every((s) => s.workspaceId === null)).toBe(true);
    expect((await call(membersGET, { url: "/api/v1/members", cookie: member.cookie })).status).toBe(409);

    // Self-leave.
    expect((await remove(viewer.cookie, viewer.userId)).status).toBe(204);
    const vm = await me(viewer.cookie);
    expect(vm.json.workspace).toBeNull();
    expect(vm.json.workspaces).toEqual([]);

    const actions = (await db.select().from(auditLog).where(eq(auditLog.workspaceId, owner.workspaceId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["member.role_change", "member.remove", "member.leave"]));
    const remaining = (await call(membersGET, { url: "/api/v1/members", cookie: admin.cookie })).json.items.map((m: { userId: string; role: string }) => [m.userId, m.role]);
    expect(remaining.sort()).toEqual([[owner.userId, "admin"], [admin.userId, "owner"]].sort());
  });
});

describe("invitations", () => {
  const invite = (cookie: string, body: unknown) => call(invitationsPOST, { url: "/api/v1/invitations", body, cookie });
  const tokenOf = (url: string) => url.split("/invite/")[1];
  const accept = (token: string, opts: { cookie?: string; body?: unknown } = {}) =>
    call(acceptPOST, { url: `/api/invitations/${token}/accept`, method: "POST", params: { token }, headers: { "x-forwarded-for": nextIp() }, ...opts });
  const info = (token: string) => call(publicInviteGET, { url: `/api/invitations/${token}`, params: { token }, headers: { "x-forwarded-for": nextIp() } });

  it("creates an invite, shows public info, and lets a new user accept with a password", async () => {
    const db = await getDb();
    const owner = await createTestWorkspace({ name: "Kerala Spices" });
    const created = await invite(owner.cookie, { email: "  New.Person@Example.com ", role: "member" });
    expect(created.status).toBe(201);
    expect(created.json.email).toBe("new.person@example.com");
    expect(created.json.url).toMatch(/^http:\/\/localhost:3000\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(created.json.url);

    // The token is only stored hashed and never listed again.
    const [row] = await db.select().from(invitations).where(eq(invitations.id, created.json.id));
    expect(row.tokenHash).not.toBe(token);
    const list = await call(invitationsGET, { url: "/api/v1/invitations", cookie: owner.cookie });
    expect(list.json.items).toHaveLength(1);
    expect(list.json.items[0].url).toBeUndefined();

    const pub = await info(token);
    expect(pub.status).toBe(200);
    expect(pub.json).toMatchObject({ workspaceName: "Kerala Spices", email: "new.person@example.com", role: "member", expired: false, accepted: false });
    expect((await info("x".repeat(43))).status).toBe(404);

    // Even with sign-ups closed, invited people can join.
    process.env.SIGNUPS_ENABLED = "false";
    expect((await accept(token, { body: { name: "New Person", password: "short" } })).status).toBe(422);
    expect((await accept(token, { body: { name: "New Person", password: "new.person@example.com" } })).status).toBe(422);
    const ok = await accept(token, { body: { name: "New Person", password: PASSWORD } });
    expect(ok.status).toBe(201);
    expect(ok.json.workspace.id).toBe(owner.workspaceId);
    expect(ok.json.role).toBe("member");
    expect(ok.json.user.email).toBe("new.person@example.com");
    const cookie = cookieFrom(ok);
    expect((await call(membersGET, { url: "/api/v1/members", cookie })).json.items).toHaveLength(2);

    // Single use.
    const again = await accept(token, { body: { name: "Someone", password: PASSWORD } });
    expect(again.status).toBe(410);
    expect((await info(token)).json.accepted).toBe(true);
    // Accepted invites can't be revoked (remove the member instead).
    expect((await call(invitationDELETE, { url: `/api/v1/invitations/${created.json.id}`, method: "DELETE", cookie: owner.cookie, params: { id: created.json.id } })).status).toBe(409);

    // Existing member → 409.
    expect((await invite(owner.cookie, { email: "new.person@example.com", role: "viewer" })).status).toBe(409);
    expect((await invite(owner.cookie, { email: owner.email, role: "viewer" })).status).toBe(409);
  });

  it("enforces roles, replaces re-invites, revokes, expires and stays within the workspace", async () => {
    const db = await getDb();
    const owner = await createTestWorkspace();
    const admin = await addMember(owner.workspaceId, "admin");
    const member = await addMember(owner.workspaceId, "member");
    const other = await createTestWorkspace();

    expect((await invite(member.cookie, { email: uniqueEmail("m"), role: "viewer" })).status).toBe(403);
    expect((await call(invitationsPOST, { url: "/api/v1/invitations", body: { email: uniqueEmail("k"), role: "viewer" }, apiKey: owner.apiKey })).status).toBe(403);
    expect((await invite(admin.cookie, { email: uniqueEmail("o"), role: "owner" })).status).toBe(403);
    expect((await invite(owner.cookie, { email: uniqueEmail("o"), role: "owner" })).status).toBe(201);
    expect((await invite(admin.cookie, { email: "bad-email", role: "viewer" })).status).toBe(422);

    // Re-inviting the same email replaces the previous link.
    const email = uniqueEmail("again");
    const first = await invite(admin.cookie, { email, role: "viewer" });
    const second = await invite(admin.cookie, { email, role: "member" });
    expect(second.status).toBe(201);
    expect((await info(tokenOf(first.json.url))).status).toBe(404);
    expect((await info(tokenOf(second.json.url))).json.role).toBe("member");
    const openRows = await db.select().from(invitations).where(and(eq(invitations.workspaceId, owner.workspaceId), eq(invitations.email, email)));
    expect(openRows).toHaveLength(1);

    // Revoke: other workspace → 404; own → 204; link dead.
    const delOpts = (cookie: string) => ({ url: `/api/v1/invitations/${second.json.id}`, method: "DELETE", cookie, params: { id: second.json.id } });
    expect((await call(invitationDELETE, delOpts(other.cookie))).status).toBe(404);
    expect((await call(invitationDELETE, delOpts(member.cookie))).status).toBe(403);
    expect((await call(invitationDELETE, delOpts(admin.cookie))).status).toBe(204);
    expect((await info(tokenOf(second.json.url))).status).toBe(404);
    expect((await call(invitationsGET, { url: "/api/v1/invitations", cookie: other.cookie })).json.items).toHaveLength(0);

    // Expired → 410.
    const exp = await invite(admin.cookie, { email: uniqueEmail("exp"), role: "viewer" });
    await db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invitations.id, exp.json.id));
    expect((await info(tokenOf(exp.json.url))).json.expired).toBe(true);
    const expired = await accept(tokenOf(exp.json.url), { body: { name: "Late", password: PASSWORD } });
    expect(expired.status).toBe(410);
    expect(expired.json.error.code).toBe("invitation_expired");

    // Pagination + open filter.
    const page1 = await call(invitationsGET, { url: "/api/v1/invitations?limit=1", cookie: admin.cookie });
    expect(page1.json.items).toHaveLength(1);
    expect(page1.json.nextCursor).toBeTruthy();
    const page2 = await call(invitationsGET, { url: `/api/v1/invitations?limit=1&cursor=${page1.json.nextCursor}`, cookie: admin.cookie });
    expect(page2.json.items).toHaveLength(1);
    expect(page2.json.items[0].id).not.toBe(page1.json.items[0].id);
    const open = await call(invitationsGET, { url: "/api/v1/invitations?status=open", cookie: admin.cookie });
    expect(open.json.items.every((i: { id: string }) => i.id !== exp.json.id)).toBe(true);

    const actions = (await db.select().from(auditLog).where(eq(auditLog.workspaceId, owner.workspaceId))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["invitation.create", "invitation.revoke"]));
  });

  it("rate limits invitation lookups per IP across different tokens", async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const token = `guess${i}`.padEnd(43, "x");
      statuses.push((await call(publicInviteGET, { url: `/api/invitations/${token}`, params: { token }, headers: { "x-forwarded-for": ip } })).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  it("lets a signed-in user accept an invite for their email, and rejects other accounts", async () => {
    const owner = await createTestWorkspace({ name: "Rao Exports" });
    const emailB = uniqueEmail("bee");
    const b = await signup(emailB);
    const cookieB = cookieFrom(b);
    const inv = await invite(owner.cookie, { email: emailB.toUpperCase(), role: "viewer" });

    // Someone else signed in → 403, invite stays usable.
    const c = await signup(uniqueEmail("cee"));
    const mismatch = await accept(tokenOf(inv.json.url), { cookie: cookieFrom(c) });
    expect(mismatch.status).toBe(403);
    expect(mismatch.json.error.code).toBe("email_mismatch");

    // Signed out with an existing account's email → 409 (sign in instead).
    expect((await accept(tokenOf(inv.json.url), { body: { name: "Imposter", password: PASSWORD } })).status).toBe(409);

    const ok = await accept(tokenOf(inv.json.url), { cookie: cookieB });
    expect(ok.status).toBe(200);
    expect(ok.json.workspace.id).toBe(owner.workspaceId);
    expect(ok.json.role).toBe("viewer");
    expect(ok.json.workspaces).toHaveLength(2);
    expect((await me(cookieB)).json.workspace.id).toBe(owner.workspaceId);
  });
});

describe("API keys", () => {
  it("creates a key shown once, authenticates with it, and revokes it", async () => {
    const db = await getDb();
    const owner = await createTestWorkspace();
    const member = await addMember(owner.workspaceId, "member");
    const other = await createTestWorkspace();
    const create = (cookie: string, body: unknown) => call(apiKeysPOST, { url: "/api/v1/api-keys", body, cookie });

    expect((await create(member.cookie, { name: "x", scopes: ["read"] })).status).toBe(403);
    expect((await call(apiKeysPOST, { url: "/api/v1/api-keys", body: { name: "x", scopes: ["read"] }, apiKey: owner.apiKey })).status).toBe(403);
    expect((await create(owner.cookie, { name: "x", scopes: [] })).status).toBe(422);
    expect((await create(owner.cookie, { name: "x", scopes: ["admin"] })).status).toBe(422);
    expect((await create(owner.cookie, { name: " ", scopes: ["read"] })).status).toBe(422);
    expect((await create(owner.cookie, { name: "x", scopes: ["read"], expiresInDays: 0 })).status).toBe(422);

    const res = await create(owner.cookie, { name: "Zapier", scopes: ["read", "ingest", "read"], expiresInDays: 30 });
    expect(res.status).toBe(201);
    const key = res.json.key as string;
    expect(key).toMatch(/^ifk_live_[A-Za-z0-9_-]{32}$/);
    expect(res.json.prefix).toBe(key.slice(0, 16));
    expect(res.json.scopes).toEqual(["ingest", "read"]);
    expect(new Date(res.json.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    expect(res.json.revokedAt).toBeNull();

    const [stored] = await db.select().from(apiKeys).where(eq(apiKeys.id, res.json.id));
    expect(stored.keyHash).not.toBe(key);
    const list = await call(apiKeysGET, { url: "/api/v1/api-keys", cookie: owner.cookie });
    const listed = list.json.items.find((k: { id: string }) => k.id === res.json.id);
    expect(listed.key).toBeUndefined();
    expect(JSON.stringify(list.json)).not.toContain(stored.keyHash);
    expect((await call(apiKeysGET, { url: "/api/v1/api-keys", cookie: member.cookie })).status).toBe(403);

    // The key works on workspace routes that allow its scope.
    const ws = await call(workspaceGET, { url: "/api/v1/workspace", apiKey: key });
    expect(ws.status).toBe(200);
    expect(ws.json.id).toBe(owner.workspaceId);
    expect((await call(workspacePATCH, { url: "/api/v1/workspace", method: "PATCH", body: { name: "x" }, apiKey: key })).status).toBe(403);

    // Revoke: other workspace → 404; own → revokedAt set (idempotent); key stops working.
    const del = (cookie: string) => call(apiKeyDELETE, { url: `/api/v1/api-keys/${res.json.id}`, method: "DELETE", cookie, params: { id: res.json.id } });
    expect((await del(other.cookie)).status).toBe(404);
    const revoked = await del(owner.cookie);
    expect(revoked.status).toBe(200);
    expect(revoked.json.revokedAt).toBeTruthy();
    expect(revoked.json.key).toBeUndefined();
    const again = await del(owner.cookie);
    expect(again.status).toBe(200);
    expect(again.json.revokedAt).toBe(revoked.json.revokedAt);
    expect((await call(workspaceGET, { url: "/api/v1/workspace", apiKey: key })).status).toBe(401);

    const audits = await db.select().from(auditLog).where(and(eq(auditLog.workspaceId, owner.workspaceId), eq(auditLog.targetId, res.json.id)));
    expect(audits.map((a) => a.action).sort()).toEqual(["api_key.create", "api_key.revoke"]);
    expect(JSON.stringify(audits)).not.toContain(key);
    expect(JSON.stringify(audits)).not.toContain(stored.keyHash);
  });
});
