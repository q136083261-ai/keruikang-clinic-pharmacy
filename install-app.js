(function () {
  const APP_URL = "https://www.keruikang.com/mobile";
  const REMEMBER_EMAIL_KEY = "nurse-last-email";
  let deferredInstallPrompt = null;

  function isMobileEntry() {
    const params = new URLSearchParams(location.search);
    return (
      params.get("mobile") === "1" ||
      params.get("source") === "pwa" ||
      location.pathname.replace(/\/$/, "").endsWith("/mobile")
    );
  }

  function isIosSafari() {
    const ua = navigator.userAgent || "";
    return /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function toastMessage(message) {
    if (typeof toast === "function") toast(message);
    else console.log(message);
  }

  function ensureWwwDomain() {
    if (location.hostname !== "keruikang.com") return;
    const next = new URL(location.href);
    next.hostname = "www.keruikang.com";
    location.replace(next.toString());
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
    try {
      await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    } catch (error) {
      console.warn("PWA service worker registration failed", error);
    }
  }

  function iPhoneGuideHtml() {
    return `
      <div class="pwa-install-guide-wrap">
        <strong>iPhone 安装方法</strong>
        <ol class="pwa-install-guide">
          <li>用 Safari 打开 www.keruikang.com/mobile</li>
          <li>点击底部分享按钮</li>
          <li>选择“添加到主屏幕”</li>
          <li>名称保持“可瑞康护士端”</li>
          <li>点击添加</li>
        </ol>
        <span>安装后请从桌面图标打开，可直接进入护士工作台。</span>
      </div>`;
  }

  function installBoxHtml(locationName) {
    return `
      <div class="pwa-install-box" data-pwa-install-box="${locationName}">
        <strong>可瑞康护士端 App</strong>
        <span>添加到手机桌面后，护士可以直接进入入库、出库和药品录入。</span>
        <button class="pwa-install-button" type="button" data-pwa-install>安装到手机桌面</button>
        <div class="pwa-ios-guide" ${isIosSafari() ? "" : "hidden"}>${iPhoneGuideHtml()}</div>
      </div>`;
  }

  function injectLoginInstallBox() {
    const loginCard = document.getElementById("loginForm");
    if (!loginCard || loginCard.querySelector("[data-pwa-install-box='login']")) return;
    loginCard.insertAdjacentHTML("beforeend", installBoxHtml("login"));
  }

  function injectMineInstallBox() {
    const minePanel = document.getElementById("mobileMinePanel");
    if (!minePanel || minePanel.querySelector("[data-pwa-install-box='mine']")) return;
    minePanel.insertAdjacentHTML("beforeend", installBoxHtml("mine"));
  }

  function injectAdminInstallButton() {
    const headerActions = document.querySelector(".header-actions");
    if (!headerActions || document.getElementById("openPwaInstallGuide")) return;
    const button = document.createElement("button");
    button.className = "btn secondary pwa-admin-install-button";
    button.id = "openPwaInstallGuide";
    button.type = "button";
    button.textContent = "安装护士手机 App";
    headerActions.prepend(button);
  }

  function injectInstallModal() {
    if (document.getElementById("pwaInstallModal")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <section class="modal pwa-install-modal" id="pwaInstallModal">
        <div class="modal-head">
          <div>
            <h2>安装护士手机 App</h2>
            <p>用护士手机扫码打开，再添加到手机桌面。</p>
          </div>
          <button class="close-btn" data-close type="button">×</button>
        </div>
        <div class="pwa-install-url">${APP_URL}</div>
        <div class="qr-wrap"><img src="/icons/nurse-app-qr.png" alt="可瑞康护士端二维码"></div>
        <div class="module-grid">
          <article class="panel">
            <h3>iPhone 安装说明</h3>
            <p>Safari → 分享 → 添加到主屏幕。</p>
          </article>
          <article class="panel">
            <h3>Android 安装说明</h3>
            <p>Chrome → 安装应用 / 添加到主屏幕。</p>
          </article>
        </div>
        <div class="form-actions">
          <button class="btn secondary" type="button" id="copyMobileAppUrl">复制手机端地址</button>
          <a class="btn primary" href="${APP_URL}" target="_blank" rel="noreferrer">打开手机端</a>
        </div>
      </section>
    `);
  }

  function setupRememberEmail() {
    const form = document.getElementById("loginForm");
    const email = form?.elements?.email;
    const remember = document.getElementById("rememberEmail");
    if (!form || !email || !remember) return;

    const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (saved && !email.value) {
      email.value = saved;
      remember.checked = true;
    }

    form.addEventListener("submit", () => {
      const value = String(email.value || "").trim();
      if (remember.checked && value) localStorage.setItem(REMEMBER_EMAIL_KEY, value);
      else localStorage.removeItem(REMEMBER_EMAIL_KEY);
    });
  }

  async function promptInstall() {
    if (isStandalone()) return toastMessage("已经以 App 方式打开。");
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      if (choice?.outcome === "accepted") toastMessage("已安装到手机桌面。");
      return;
    }
    if (isIosSafari()) {
      document.querySelectorAll(".pwa-ios-guide").forEach(node => node.hidden = false);
      toastMessage("请按页面上的 iPhone 安装步骤添加到主屏幕。");
      return;
    }
    toastMessage("如果没有弹出安装窗口，请用浏览器菜单选择“安装应用”或“添加到主屏幕”。");
  }

  function bindEvents() {
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      document.querySelectorAll("[data-pwa-install]").forEach(button => button.hidden = false);
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      toastMessage("已安装到手机桌面。");
    });

    document.addEventListener("click", event => {
      if (event.target.closest("[data-pwa-install]")) {
        event.preventDefault();
        promptInstall();
      }

      if (event.target.closest("#openPwaInstallGuide")) {
        event.preventDefault();
        if (typeof openModal === "function") openModal("pwaInstallModal");
      }

      if (event.target.closest("#copyMobileAppUrl")) {
        event.preventDefault();
        navigator.clipboard?.writeText(APP_URL);
        toastMessage("手机端地址已复制。");
      }

      if (event.target.closest("#loginSwitchAccountBtn")) {
        event.preventDefault();
        window.forceSignOutAndShowLogin?.("switch_account");
      }
    });
  }

  function init() {
    ensureWwwDomain();
    if (isMobileEntry()) {
      document.documentElement.classList.add("pwa-mobile-entry");
      document.body.classList.add("pwa-mobile-entry");
    }
    registerServiceWorker();
    setupRememberEmail();
    injectLoginInstallBox();
    injectMineInstallBox();
    injectAdminInstallButton();
    injectInstallModal();
    bindEvents();

    const baseRender = window.render;
    if (typeof baseRender === "function" && !baseRender.__pwaWrapped) {
      window.render = function () {
        baseRender.apply(this, arguments);
        injectMineInstallBox();
      };
      window.render.__pwaWrapped = true;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
