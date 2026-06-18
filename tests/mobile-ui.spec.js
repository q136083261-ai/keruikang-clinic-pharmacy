const fs = require("fs");
const http = require("http");
const path = require("path");
const { test, expect } = require("@playwright/test");
const { AxeBuilder } = require("@axe-core/playwright");

const root = path.resolve(__dirname, "..");
const afterDir = path.join(root, "test-artifacts", "mobile-ui-after");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const viewports = [
  ["android-small", 360, 800],
  ["iphone13", 390, 844],
  ["android-common", 412, 915],
  ["iphone15promax", 430, 932]
];

const panels = [
  ["login", null],
  ["home", "home"],
  ["stock-in", "in"],
  ["stock-out", "out"],
  ["new-medicine", "new"],
  ["today", "today"],
  ["mine", "mine"]
];

let server;
let baseUrl;

function startServer() {
  return new Promise(resolve => {
    server = http.createServer((req, res) => {
      let pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      if (pathname === "/" || pathname === "/mobile") pathname = "/index.html";
      const file = path.join(root, pathname.replace(/^\/+/, ""));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": mimeTypes[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

async function openMobile(page) {
  await page.goto(`${baseUrl}/mobile?mobile=1`, { waitUntil: "load" });
  await page.waitForTimeout(350);
}

async function showPanel(page, panel) {
  if (!panel) return;
  await page.evaluate(currentPanel => {
    document.getElementById("loginScreen")?.classList.add("hidden");
    document.body.classList.add("mobile-nurse-mode");
    const sidebar = document.querySelector(".sidebar");
    const desktopMain = document.querySelector("body > main");
    if (sidebar) sidebar.style.setProperty("display", "none", "important");
    if (desktopMain) desktopMain.style.setProperty("display", "none", "important");
    const app = document.getElementById("mobileNurseApp");
    app?.removeAttribute("hidden");
    if (app) app.style.display = "block";
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = "Stock in failed: this is a long mobile error message used to verify wrapping and bottom navigation spacing.";
      toast.style.display = "none";
    }
    const ids = {
      home: "mobileHomePanel",
      in: "mobileStockInPanel",
      out: "mobileStockOutPanel",
      new: "mobileNewMedicinePanel",
      today: "mobileTodayPanel",
      mine: "mobileMinePanel"
    };
    Object.entries(ids).forEach(([key, id]) => {
      document.getElementById(id)?.classList.toggle("active", key === currentPanel);
    });
    document.querySelectorAll("[data-mobile-go]").forEach(button => {
      button.classList.toggle("active", button.dataset.mobileGo === currentPanel);
    });
    const today = document.getElementById("mobileTodayList");
    if (today && !today.innerHTML.trim()) {
      today.innerHTML = '<div class="mobile-record-card"><strong>Stock in - Sample Medicine</strong><span>Batch 240901 - Qty 7 - 09:30</span></div>';
    }
  }, panel);
}

async function layoutMetrics(page) {
  return page.evaluate(() => {
    const nav = document.querySelector(".mobile-bottom-nav")?.getBoundingClientRect();
    const submitEl = document.querySelector(".mobile-panel.active .mobile-submit-bar");
    if (submitEl) submitEl.scrollIntoView({ block: "end" });
    const submit = submitEl?.getBoundingClientRect();
    const controls = Array.from(document.querySelectorAll(".mobile-panel.active input:not([type='checkbox']), .mobile-panel.active select, .mobile-panel.active textarea, .mobile-panel.active button, .mobile-panel.active .mobile-check"))
      .filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map(el => el.getBoundingClientRect());
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth,
      overflowX: document.documentElement.scrollWidth > innerWidth + 1,
      navTop: nav?.top ?? null,
      navHeight: nav?.height ?? null,
      submitBottom: submit?.bottom ?? null,
      minTarget: controls.length ? Math.min(...controls.map(rect => Math.min(rect.width, rect.height))) : null
    };
  });
}

async function clearToast(page) {
  await page.evaluate(() => {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.textContent = "";
      toast.style.display = "none";
    }
  });
}

test.beforeAll(async () => {
  fs.mkdirSync(afterDir, { recursive: true });
  await startServer();
});

test.afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

for (const [device, width, height] of viewports) {
  test.describe(`${device} ${width}x${height}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    for (const [name, panel] of panels) {
      test(`${name} layout and screenshot`, async ({ page }) => {
        await openMobile(page);
        await showPanel(page, panel);
        await page.waitForTimeout(100);
        await clearToast(page);
        await page.screenshot({
          path: path.join(afterDir, `${device}-${width}x${height}-${name}.png`),
          fullPage: true
        });

        const metrics = await layoutMetrics(page);
        expect(metrics.overflowX, JSON.stringify(metrics)).toBe(false);
        if (metrics.submitBottom && metrics.navTop) {
          expect(metrics.submitBottom, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.navTop - 4);
        }
        if (metrics.minTarget !== null) {
          expect(metrics.minTarget, JSON.stringify(metrics)).toBeGreaterThanOrEqual(44);
        }
        await expect(page).toHaveScreenshot(`${device}-${width}x${height}-${name}.png`, { fullPage: true });
      });
    }
  });
}

test("mobile toast is readable above bottom navigation", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openMobile(page);
  await showPanel(page, "in");
  await page.evaluate(() => {
    const toast = document.getElementById("toast");
    toast.textContent = "Stock in failed: this is a long mobile error message used to verify wrapping and bottom navigation spacing.";
    toast.style.display = "block";
  });
  const metrics = await page.evaluate(() => {
    const toast = document.getElementById("toast").getBoundingClientRect();
    const nav = document.querySelector(".mobile-bottom-nav").getBoundingClientRect();
    return { toastBottom: toast.bottom, navTop: nav.top, toastHeight: toast.height };
  });
  expect(metrics.toastBottom).toBeLessThanOrEqual(metrics.navTop - 4);
  expect(metrics.toastHeight).toBeGreaterThan(36);
});

test("mobile nurse shell has no serious axe violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMobile(page);
  await showPanel(page, "in");
  const results = await new AxeBuilder({ page })
    .include("#mobileNurseApp")
    .analyze();
  expect(results.violations).toEqual([]);
});
