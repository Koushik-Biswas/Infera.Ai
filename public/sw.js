/* Infera service worker: offline app shell + WhatsApp share target. */
const VERSION = "infera-v2";
const SHELL = ["/offline", "/download", "/icons/icon-192.png", "/icons/icon-512.png"];
const SHARE_CACHE = "infera-share";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((f) => f && typeof f === "object" && "name" in f);
    const cache = await caches.open(SHARE_CACHE);
    for (const key of await cache.keys()) await cache.delete(key);
    let i = 0;
    for (const file of files) {
      await cache.put(
        `/__shared/${i++}`,
        new Response(file, { headers: { "X-File-Name": encodeURIComponent(file.name), "Content-Type": file.type || "application/octet-stream" } }),
      );
    }
    const text = form.get("text");
    if (!files.length && typeof text === "string" && text.trim()) {
      await cache.put("/__shared/0", new Response(text, { headers: { "X-File-Name": "Shared chat.txt", "Content-Type": "text/plain" } }));
    }
    return Response.redirect("/offline#/chats?import=shared", 303);
  } catch {
    return Response.redirect("/offline#/chats?import=1", 303);
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.method === "POST" && url.pathname === "/app/share-target") {
    event.respondWith(handleShare(req));
    return;
  }
  if (req.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // Hashed build assets and icons never change: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
            return res;
          }),
      ),
    );
    return;
  }

  // Pages: network first so updates arrive immediately; cached copy when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(url.pathname, copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(url.pathname)) || (await caches.match("/offline")) || Response.error()),
    );
  }
});
