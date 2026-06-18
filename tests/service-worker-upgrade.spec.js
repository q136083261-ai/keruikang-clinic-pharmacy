const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { test, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const assetVersion = "1.1.2";
const cacheName = `keruikang-nurse-pwa-v${assetVersion}`;
const oldCacheName = "keruikang-nurse-pwa-v1.1.1";

function readFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function serviceWorkerSourceFor(version) {
  if (version === assetVersion) return readFile("service-worker.js");
  return `
const CACHE_NAME = "${oldCacheName}";
const STATIC_ASSETS = ["/mobile", "/install-app.js", "/mobile-nurse.css"];

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
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname === "/mobile") {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }
  if (url.pathname === "/install-app.js" || url.pathname === "/mobile-nurse.css") {
    event.respondWith(
      caches.match(event.request)
        .then(cached => cached || fetch(event.request).then(response => {
          if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(event.request, response.clone()));
          return response;
        }))
    );
  }
});
`;
}

function installAppSourceFor(version) {
  if (version === assetVersion) return readFile("install-app.js");
  return `
(function () {
  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    } catch (error) {
      console.warn("old service worker registration failed", error);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", registerServiceWorker);
  else registerServiceWorker();
})();
`;
}

function htmlFor(version) {
  const versioned = version === assetVersion;
  const cssHref = versioned ? `/mobile-nurse.css?v=${assetVersion}` : "/mobile-nurse.css";
  const installSrc = versioned ? `/install-app.js?v=${assetVersion}` : "/install-app.js";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${cssHref}">
  <script>
    const loadCount = Number(sessionStorage.getItem("sw-upgrade-load-count") || "0") + 1;
    sessionStorage.setItem("sw-upgrade-load-count", String(loadCount));
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        const count = Number(sessionStorage.getItem("sw-upgrade-controllerchange-count") || "0") + 1;
        sessionStorage.setItem("sw-upgrade-controllerchange-count", String(count));
      });
    }
  </script>
</head>
<body>
  <main id="app">PWA upgrade ${version}</main>
  <script src="${installSrc}"></script>
</body>
</html>`;
}

function contentTypeFor(pathname) {
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  if (pathname.endsWith(".png")) return "image/png";
  return "text/html; charset=utf-8";
}

async function startServer(state) {
  const currentCss = readFile("mobile-nurse.css");
  const oldCss = "body { background: rgb(251, 228, 228); }";
  const manifest = JSON.stringify({ name: "Keruikang test", start_url: "/mobile", display: "standalone" });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;
    const version = state.version;
    let body;

    if (pathname === "/" || pathname === "/mobile" || pathname === "/index.html") body = htmlFor(version);
    else if (pathname === "/service-worker.js") body = serviceWorkerSourceFor(version);
    else if (pathname === "/install-app.js") body = installAppSourceFor(version);
    else if (pathname === "/mobile-nurse.css") body = version === assetVersion ? currentCss : oldCss;
    else if (pathname === "/manifest.webmanifest") body = manifest;
    else if (pathname.startsWith("/icons/")) body = "";
    else body = "ok";

    res.writeHead(200, {
      "Content-Type": contentTypeFor(pathname),
      "Cache-Control": "no-store"
    });
    res.end(body);
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
    currentCssSha: sha256(currentCss),
    currentInstallSha: sha256(readFile("install-app.js")),
    oldCssSha: sha256(oldCss),
    oldInstallSha: sha256(installAppSourceFor("1.1.1"))
  };
}

async function waitForController(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10_000 });
}

test("PWA assets use the versioned 1.1.2 upgrade contract", async () => {
  const serviceWorker = readFile("service-worker.js");
  const staticAssets = serviceWorker.match(/const STATIC_ASSETS = \[([\s\S]*?)\];/)[1];

  expect(serviceWorker).toContain(`const CACHE_NAME = "${cacheName}";`);
  expect(staticAssets).toContain(`"/mobile-nurse.css?v=${assetVersion}"`);
  expect(staticAssets).toContain(`"/install-app.js?v=${assetVersion}"`);
  expect(staticAssets).not.toMatch(/["']\/mobile-nurse\.css["']/);
  expect(staticAssets).not.toMatch(/["']\/install-app\.js["']/);

  expect(readFile("index.html")).toContain(`href="/mobile-nurse.css?v=${assetVersion}"`);
  expect(readFile("index.html")).toContain(`src="/install-app.js?v=${assetVersion}"`);
  expect(readFile("install.html")).toContain(`src="/install-app.js?v=${assetVersion}"`);
  expect(readFile(path.join("install", "index.html"))).toContain(`src="/install-app.js?v=${assetVersion}"`);

  const installApp = readFile("install-app.js");
  expect(installApp).toContain("controllerchange");
  expect(installApp).toContain("registration.update()");
  expect(installApp).toContain("hadController");
});

test("fresh PWA install does not auto reload the page", async ({ page }) => {
  const state = { version: assetVersion };
  const server = await startServer(state);
  try {
    await page.goto(`${server.origin}/mobile`, { waitUntil: "load" });
    await waitForController(page);
    await page.waitForTimeout(800);

    const result = await page.evaluate(async expectedCacheName => {
      return {
        loadCount: Number(sessionStorage.getItem("sw-upgrade-load-count") || "0"),
        controllerChanges: Number(sessionStorage.getItem("sw-upgrade-controllerchange-count") || "0"),
        cacheKeys: await caches.keys(),
        hasController: Boolean(navigator.serviceWorker.controller),
        expectedCacheExists: (await caches.keys()).includes(expectedCacheName)
      };
    }, cacheName);

    expect(result.loadCount).toBe(1);
    expect(result.hasController).toBe(true);
    expect(result.expectedCacheExists).toBe(true);
    expect(result.cacheKeys).toContain(cacheName);
  } finally {
    await server.close();
  }
});

test("old unversioned worker upgrades once and serves current versioned assets", async ({ page }) => {
  const state = { version: "1.1.1" };
  const server = await startServer(state);
  try {
    await page.goto(`${server.origin}/mobile`, { waitUntil: "load" });
    await waitForController(page);

    const oldState = await page.evaluate(async expectedOldCacheName => {
      const css = await (await fetch("/mobile-nurse.css")).text();
      const install = await (await fetch("/install-app.js")).text();
      return {
        css,
        install,
        cacheKeys: await caches.keys(),
        hasController: Boolean(navigator.serviceWorker.controller),
        oldCacheExists: (await caches.keys()).includes(expectedOldCacheName)
      };
    }, oldCacheName);

    expect(oldState.hasController).toBe(true);
    expect(oldState.oldCacheExists).toBe(true);
    expect(sha256(oldState.css)).toBe(server.oldCssSha);
    expect(sha256(oldState.install)).toBe(server.oldInstallSha);

    await page.evaluate(() => {
      sessionStorage.setItem("sw-upgrade-load-count", "0");
      sessionStorage.setItem("sw-upgrade-controllerchange-count", "0");
    });
    state.version = assetVersion;

    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => Number(sessionStorage.getItem("sw-upgrade-load-count") || "0") >= 2, null, { timeout: 15_000 });
    await page.waitForTimeout(800);

    const finalState = await page.evaluate(async ({ expectedCacheName, expectedOldCacheName, version }) => {
      const css = await (await fetch(`/mobile-nurse.css?v=${version}`)).text();
      const install = await (await fetch(`/install-app.js?v=${version}`)).text();
      const keys = await caches.keys();
      return {
        loadCount: Number(sessionStorage.getItem("sw-upgrade-load-count") || "0"),
        controllerChanges: Number(sessionStorage.getItem("sw-upgrade-controllerchange-count") || "0"),
        css,
        install,
        cacheKeys: keys,
        hasCurrentCache: keys.includes(expectedCacheName),
        hasOldCache: keys.includes(expectedOldCacheName),
        hasController: Boolean(navigator.serviceWorker.controller)
      };
    }, { expectedCacheName: cacheName, expectedOldCacheName: oldCacheName, version: assetVersion });

    expect(finalState.loadCount).toBe(2);
    expect(finalState.controllerChanges).toBe(1);
    expect(finalState.hasController).toBe(true);
    expect(finalState.hasCurrentCache).toBe(true);
    expect(finalState.hasOldCache).toBe(false);
    expect(finalState.cacheKeys).toContain(cacheName);
    expect(sha256(finalState.css)).toBe(server.currentCssSha);
    expect(sha256(finalState.install)).toBe(server.currentInstallSha);
  } finally {
    await server.close();
  }
});
