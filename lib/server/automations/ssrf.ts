/**
 * SSRF guard for outbound webhooks (admin-configured URLs that the server POSTs to).
 *
 * - `checkWebhookUrl(url)` — synchronous URL checks used when an endpoint is created or
 *   changed: http(s) only (https required in production), no credentials in the URL,
 *   and no literal private/loopback/link-local/metadata addresses or local host names.
 * - `assertPublicDestination(url)` — at delivery time: resolves the host with
 *   `dns.promises.lookup(host, { all: true })` and rejects if ANY address is private.
 *
 * Private destinations are allowed outside production, or with ALLOW_PRIVATE_WEBHOOKS=1
 * (self-hosted setups that deliver to services on the same network).
 * Environment variables are read at call time so tests can stub them.
 */
import dns from "node:dns";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

const production = () => process.env.NODE_ENV === "production";

/** Private / internal destinations are acceptable (dev, test, or explicitly allowed). */
export const privateDestinationsAllowed = () => process.env.ALLOW_PRIVATE_WEBHOOKS === "1" || !production();

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback", "metadata", "metadata.google.internal", "instance-data", "kubernetes.default"]);
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".home.arpa", ".svc", ".cluster.local"];

/* ------------------------------- IPv4 -------------------------------- */

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const b = Number(p);
    if (b > 255) return null;
    n = n * 256 + b;
  }
  return n;
}

const cidr4 = (base: string, bits: number) => {
  const b = v4ToInt(base)!;
  const size = 2 ** (32 - bits);
  return (n: number) => n >= b && n < b + size;
};

const V4_BLOCKS = [
  cidr4("0.0.0.0", 8), // "this" network (0.0.0.0 reaches localhost on Linux)
  cidr4("10.0.0.0", 8), // private
  cidr4("100.64.0.0", 10), // carrier-grade NAT
  cidr4("127.0.0.0", 8), // loopback
  cidr4("169.254.0.0", 16), // link-local incl. 169.254.169.254 cloud metadata
  cidr4("172.16.0.0", 12), // private
  cidr4("192.0.0.0", 24), // IETF protocol assignments
  cidr4("192.0.2.0", 24), // documentation
  cidr4("192.88.99.0", 24), // 6to4 relay
  cidr4("192.168.0.0", 16), // private
  cidr4("198.18.0.0", 15), // benchmarking
  cidr4("198.51.100.0", 24), // documentation
  cidr4("203.0.113.0", 24), // documentation
  cidr4("224.0.0.0", 4), // multicast
  cidr4("240.0.0.0", 4), // reserved + broadcast
];

function blockedV4(ip: string): boolean {
  const n = v4ToInt(ip);
  if (n === null) return true; // unparseable → refuse
  return V4_BLOCKS.some((inBlock) => inBlock(n));
}

/* ------------------------------- IPv6 -------------------------------- */

/** Expands an IPv6 address into 8 16-bit groups (handles "::" and an embedded IPv4 tail). */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(":");
  const maybeV4 = s.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const n = v4ToInt(maybeV4);
    if (n === null) return null;
    tail = [Math.floor(n / 65536), n % 65536];
    s = s.slice(0, lastColon + 1) + "0:0"; // placeholder groups, replaced below
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part ? part.split(":").map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if ([...head, ...rest].some((x) => Number.isNaN(x))) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else groups = head;
  if (groups.length !== 8) return null;
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups;
}

function blockedV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const allZeroUntil = (i: number) => g.slice(0, i).every((x) => x === 0);
  if (g.every((x) => x === 0)) return true; // ::
  if (allZeroUntil(7) && g[7] === 1) return true; // ::1
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d → judge the IPv4 address.
  if (allZeroUntil(5) && (g[5] === 0xffff || g[5] === 0)) return blockedV4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  // NAT64 64:ff9b::/96 → embedded IPv4.
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedV4(`${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`);
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local (incl. fd00:ec2::254 metadata)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x2002) {
    // 6to4: 2002:AABB:CCDD:: embeds an IPv4 address.
    return blockedV4(`${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`);
  }
  return false;
}

/** True for loopback, private, link-local, unique-local, unspecified, metadata and other non-public addresses. */
export function isBlockedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return blockedV4(ip);
  if (kind === 6) return blockedV6(ip);
  return true;
}

/* ------------------------------- URLs -------------------------------- */

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

const bareHost = (u: URL) => u.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");

/** Synchronous checks (no DNS): scheme, credentials, literal IPs and local host names. */
export function checkWebhookUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Enter a valid URL, e.g. https://example.com/webhooks/infera." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, reason: "Only http(s) URLs are supported." };
  if (production() && url.protocol !== "https:") return { ok: false, reason: "Webhook URLs must use https." };
  if (url.username || url.password) return { ok: false, reason: "Don't put credentials in the URL — verify requests with the signing secret instead." };
  const host = bareHost(url);
  if (!host) return { ok: false, reason: "The URL has no host." };
  if (url.href.length > 2000) return { ok: false, reason: "The URL is too long." };
  if (!privateDestinationsAllowed()) {
    if (net.isIP(host)) {
      if (isBlockedIp(host)) return { ok: false, reason: "Webhook URLs can't point to private, loopback or link-local addresses." };
    } else {
      if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: "Webhook URLs can't point to local or internal host names." };
      if (!host.includes(".")) return { ok: false, reason: "Use a fully-qualified public host name." };
    }
  }
  return { ok: true, url };
}

/**
 * Delivery-time check: re-validates the URL and resolves the host; throws
 * SsrfBlockedError if any resolved address is not public. DNS failures are thrown
 * as ordinary errors (transient — the delivery is retried).
 */
export async function assertPublicDestination(rawUrl: string): Promise<URL> {
  const checked = checkWebhookUrl(rawUrl);
  if (!checked.ok) throw new SsrfBlockedError(checked.reason);
  if (privateDestinationsAllowed()) return checked.url;
  const host = bareHost(checked.url);
  if (net.isIP(host)) return checked.url; // literal already checked above
  const addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("The webhook host did not resolve.");
  if (addresses.some((a) => isBlockedIp(a.address))) throw new SsrfBlockedError("The webhook host resolves to a private or internal address.");
  return checked.url;
}
