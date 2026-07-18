// Service worker for Payment Requests PWA
// - Basic app-shell caching so the app opens instantly on repeat visits
// - Push notification handler
// - Notification click → open the request URL

const CACHE = "pay-app-v2";
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
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
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
    // personalized snapshot.
    event.respondWith(
      fetch(req).catch(() => caches.match("/offline.html").then((r) => r || Response.error())),
    );
    return;
  }
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
