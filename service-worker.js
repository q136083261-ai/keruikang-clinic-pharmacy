const CACHE_NAME = "keruikang-nurse-pwa-v1.1.1";

const STATIC_ASSETS = [
  "/mobile",
  "/mobile.html",
  "/install",
  "/install/index.html",
  "/install.html",
  "/app",
  "/app/index.html",
  "/nurse-app",
  "/nurse-app/index.html",
  "/manifest.webmanifest",
  "/service-worker.js",
  "/install-app.css",
  "/install-app.js",
  "/mobile-nurse.css",
  "/mobile-nurse.js",
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

function isHtmlShell(pathname) {
  return ["/mobile", "/mobile.html", "/install", "/install.html", "/app", "/nurse-app"].includes(pathname);
}

function isCacheableStatic(url) {
  if (url.origin !== self.location.origin) return false;
  return (
    STATIC_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith("/icons/") ||
    /^\/(install-app|mobile-nurse)\.(css|js)$/i.test(url.pathname) ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/service-worker.js"
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

  if (isHtmlShell(url.pathname)) {
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
          if (cached) return cached;
          if (["/install", "/app", "/nurse-app"].includes(url.pathname)) return caches.match("/install.html");
          return caches.match("/mobile.html");
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
