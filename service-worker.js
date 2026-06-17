const CACHE_NAME = "keruikang-nurse-pwa-v1.0.0";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/mobile",
  "/mobile.html",
  "/manifest.webmanifest",
  "/install-app.css",
  "/install-app.js",
  "/mobile-nurse.css",
  "/mobile-nurse.js",
  "/styles.css",
  "/auth-password.css",
  "/supabase-config.js",
  "/cloud-sync.js",
  "/auth-session.js",
  "/cloud-inventory.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/nurse-app-qr.png"
];

function isSensitiveRequest(url) {
  const hostname = url.hostname.toLowerCase();
  const pathname = url.pathname.toLowerCase();
  return (
    pathname.startsWith("/api/") ||
    hostname.endsWith(".supabase.co") ||
    hostname.includes("supabase.co") ||
    pathname.includes("/auth/v1") ||
    pathname.includes("/rest/v1") ||
    pathname.includes("/rpc/") ||
    pathname.includes("/functions/v1")
  );
}

function isHtmlRequest(request, url) {
  return (
    request.mode === "navigate" ||
    request.headers.get("accept")?.includes("text/html") ||
    url.pathname === "/mobile" ||
    url.pathname.endsWith(".html")
  );
}

function isCacheableStatic(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    STATIC_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith("/icons/") ||
    /\.(css|js|png|svg|webmanifest)$/i.test(url.pathname)
  );
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(STATIC_ASSETS.map(asset => cache.add(asset))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isSensitiveRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (isHtmlRequest(request, url)) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/mobile.html") || caches.match("/index.html");
        })
    );
    return;
  }

  if (isCacheableStatic(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
  }
});
