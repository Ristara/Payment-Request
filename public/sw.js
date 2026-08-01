// Service worker for Payment Requests PWA
// - Basic app-shell caching so the app opens instantly on repeat visits
// - Push notification handler
// - Notification click → open the request URL

// Bumped to v4 to evict a poisoned entry: the old cache holds a copy of
// ria-capture-worklet.js from before it carried audio levels, and activate()
// below deletes every cache whose name is not this one.
const CACHE = "pay-app-v4";
// Precache ONLY truly static files. Never SSR HTML — install-time HTML
// snapshots go stale, can capture a login redirect, and every install
// would re-run the server's full query fan-out for pages nobody asked for.
const APP_SHELL = ["/offline.html", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Navigation preload starts the network request in parallel with the
      // worker booting — without it, a cold PWA launch waits for the SW to
      // spin up before it even asks for the page.
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch {}
      }
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Network-first for HTML navigations; cache-first for static assets.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Never intercept Supabase or Google auth requests
  if (url.hostname.includes("supabase") || url.hostname.includes("google")) return;

  if (req.mode === "navigate") {
    // Network-first; offline fallback is a static page, never a stale
    // personalized snapshot. The FIRST request of a session on mobile often
    // fails while the radio wakes up (or a sleeping serverless function is
    // starting), so retry once before declaring the user offline — otherwise
    // opening the installed app cold shows "You\u0027re offline" every time.
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;
          return await fetch(req);
        } catch {
          try {
            return await fetch(req, { cache: "reload" });
          } catch {
            const fallback = await caches.match("/offline.html");
            return fallback || Response.error();
          }
        }
      })(),
    );
    return;
  }
  // The capture worklet is never cached. It is one half of a contract with
  // src/lib/live/audio.ts — the worklet posts a message shape, the page parses
  // it — and caching one half means a new page can be handed an old worklet
  // that speaks the previous shape. That is not theoretical: it silently
  // stopped all microphone audio reaching Gemini, so Ria greeted and then
  // never responded, with no error anywhere because the fetch itself
  // succeeded. Everything under /_next/static/ is content-hashed and cannot
  // go stale this way; this file is not.
  if (url.pathname === "/ria-capture-worklet.js") return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.match(/\.(png|jpg|svg|css|js|ico)$/)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(req, clone)).catch(() => {});
            return res;
          }),
      ),
    );
  }
});

// Push handler
self.addEventListener("push", (event) => {
  let data = { title: "New notification", body: "", url: "/notifications" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url },
      tag: data.tag || "pay-app",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/notifications";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = clients.find((c) => c.url.includes(url) || c.focused);
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: "navigate", url });
      } else {
        await self.clients.openWindow(url);
      }
    })(),
  );
});
