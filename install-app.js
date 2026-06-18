(function () {
  const MOBILE_URL = "https://www.keruikang.com/mobile";
  const INSTALL_URL = "https://www.keruikang.com/install";
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

  function deviceInfo() {
    const ua = navigator.userAgent || "";
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    const wechat = /micromessenger/i.test(ua);
    const ios = /iphone|ipad|ipod/i.test(ua);
    const android = /android/i.test(ua);
    const iosSafari = ios && /safari/i.test(ua) && !/crios|fxios|edgios|micromessenger/i.test(ua);
    const androidChrome = android && /chrome/i.test(ua) && !/edga|opr|samsungbrowser|micromessenger/i.test(ua);
    return { standalone, wechat, ios, android, iosSafari, androidChrome };
  }

  function isStandalone() {
    return deviceInfo().standalone;
  }

  function showLocalNotice(message) {
    const old = document.querySelector(".pwa-toast");
    if (old) old.remove();
    const node = document.createElement("div");
    node.className = "pwa-toast";
    node.textContent = message;
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 2800);
  }

  function toastMessage(message) {
    if (typeof toast === "function") toast(message);
    else showLocalNotice(message);
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

    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloadingForUpdate = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });

    try {
      const registration = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
      if (hadController) {
        registration.update().catch(error => {
          console.warn("PWA service worker update check failed", error);
        });
      }
    } catch (error) {
      console.warn("PWA service worker registration failed", error);
    }
  }

  function guideHtml() {
    const info = deviceInfo();
    if (info.standalone) {
      return `
        <h2>已安装成功</h2>
        <p>你现在已经用手机桌面 App 方式打开。以后护士直接点桌面的“可瑞康护士端”图标即可。</p>
        <div class="install-guide-actions">
          <a href="${MOBILE_URL}">进入护士工作台</a>
        </div>`;
    }
    if (info.wechat) {
      return `
        <h2>请用浏览器打开</h2>
        <p>微信里不能直接安装到手机桌面。请先点右上角“...”菜单，选择“在浏览器打开”。</p>
        <ol>
          <li>点右上角“...”</li>
          <li>选择“在浏览器打开”</li>
          <li>回到本页面后，再点“安装到手机桌面”</li>
        </ol>
        <div class="install-guide-actions">
          <button type="button" data-copy-url="${INSTALL_URL}">复制安装页链接</button>
        </div>`;
    }
    if (info.ios) {
      return `
        <h2>iPhone 安装方法</h2>
        <p>iPhone 需要用 Safari 手动添加到主屏幕。</p>
        <ol>
          <li>用 Safari 打开 <strong>www.keruikang.com/install</strong></li>
          <li>点击底部分享按钮</li>
          <li>选择“添加到主屏幕”</li>
          <li>名称保持“可瑞康护士端”</li>
          <li>点击“添加”，然后回到桌面打开</li>
        </ol>
        <div class="install-guide-actions">
          <a href="${MOBILE_URL}">打开护士端</a>
        </div>`;
    }
    if (info.androidChrome) {
      return `
        <h2>Android 安装方法</h2>
        <p>请使用 Chrome 浏览器安装。如果没有弹出安装窗口，可以从浏览器菜单手动安装。</p>
        <ol>
          <li>点击“安装到手机桌面”</li>
          <li>如果没有弹窗，点 Chrome 右上角“⋮”</li>
          <li>选择“安装应用”或“添加到主屏幕”</li>
          <li>安装后从手机桌面打开“可瑞康护士端”</li>
        </ol>
        <div class="install-guide-actions">
          <button type="button" data-pwa-install>安装到手机桌面</button>
          <a href="${MOBILE_URL}">打开护士端</a>
        </div>`;
    }
    return `
      <h2>浏览器安装方法</h2>
      <p>建议用手机自带浏览器、Safari 或 Chrome 打开本页，然后添加到手机桌面。</p>
      <ol>
        <li>复制安装页链接发到护士手机</li>
        <li>用手机浏览器打开</li>
        <li>按页面提示安装到桌面</li>
      </ol>
      <div class="install-guide-actions">
        <button type="button" data-copy-url="${INSTALL_URL}">复制安装页链接</button>
        <a href="${MOBILE_URL}">打开护士端</a>
      </div>`;
  }

  function renderInstallPageGuide() {
    const box = document.getElementById("installDeviceGuide");
    if (!box) return;
    box.innerHTML = guideHtml();
  }

  function installBoxHtml(locationName) {
    const installed = isStandalone();
    return `
      <div class="pwa-install-box" data-pwa-install-box="${locationName}">
        <strong>${installed ? "已安装到手机桌面" : "安装护士端到手机桌面"}</strong>
        <span class="pwa-install-status">${installed ? "当前正在以手机 App 方式运行。" : "安装后护士点桌面图标即可登录操作。"}</span>
        <button class="pwa-install-button" type="button" ${installed ? `data-open-mobile` : `data-pwa-install`}>
          ${installed ? "进入护士工作台" : "安装到手机桌面"}
        </button>
        <a class="pwa-install-help" href="${INSTALL_URL}" target="_blank" rel="noreferrer">查看安装说明</a>
      </div>`;
  }

  function decorateMobileLogin() {
    if (!isMobileEntry()) return;
    const form = document.getElementById("loginForm");
    const title = form?.querySelector("h2");
    const subtitle = form?.querySelector(".login-subtitle");
    if (title) title.textContent = "可瑞康护士端";
    if (subtitle) subtitle.textContent = "药品入库、出库和药品录入";
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
    button.textContent = "安装护士 App";
    headerActions.prepend(button);
  }

  function injectInstallModal() {
    if (document.getElementById("pwaInstallModal")) return;
    document.body.insertAdjacentHTML("beforeend", `
      <section class="modal pwa-install-modal" id="pwaInstallModal">
        <div class="modal-head">
          <div>
            <h2>安装护士 App</h2>
            <p>让护士用手机扫描二维码打开安装页，再添加到手机桌面。</p>
          </div>
          <button class="close-btn" data-close type="button">×</button>
        </div>
        <div class="pwa-install-url">${INSTALL_URL}</div>
        <div class="qr-wrap"><img src="/icons/nurse-app-qr.png" alt="可瑞康护士端安装二维码"></div>
        <div class="module-grid">
          <article class="panel">
            <h3>iPhone</h3>
            <p>Safari 打开安装页 → 分享 → 添加到主屏幕。</p>
          </article>
          <article class="panel">
            <h3>Android</h3>
            <p>Chrome 打开安装页 → 安装应用 / 添加到主屏幕。</p>
          </article>
        </div>
        <div class="form-actions">
          <button class="btn secondary" type="button" data-copy-url="${INSTALL_URL}">复制安装页链接</button>
          <button class="btn secondary" type="button" id="printPwaInstallGuide">打印安装说明</button>
          <a class="btn primary" href="${INSTALL_URL}" target="_blank" rel="noreferrer">打开安装页</a>
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
    const info = deviceInfo();
    if (info.standalone) {
      toastMessage("已安装到手机桌面。");
      return;
    }
    if (info.wechat) {
      renderInstallPageGuide();
      toastMessage("请先用手机浏览器打开，再安装到桌面。");
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      if (choice?.outcome === "accepted") toastMessage("已安装到手机桌面。");
      return;
    }
    renderInstallPageGuide();
    if (info.ios) {
      toastMessage("iPhone 请按页面步骤：分享 → 添加到主屏幕。");
      return;
    }
    toastMessage("如果没有弹出安装窗口，请从浏览器菜单选择“安装应用”或“添加到主屏幕”。");
  }

  async function copyText(value) {
    try {
      await navigator.clipboard?.writeText(value);
      toastMessage("链接已复制。");
    } catch (error) {
      console.warn("Copy failed", error);
      toastMessage("复制失败，请手动复制页面上的链接。");
    }
  }

  function bindEvents() {
    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      deferredInstallPrompt = event;
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      toastMessage("已安装到手机桌面。");
      renderInstallPageGuide();
    });

    document.addEventListener("click", event => {
      const installButton = event.target.closest("[data-pwa-install]");
      if (installButton) {
        event.preventDefault();
        promptInstall();
      }

      const openMobile = event.target.closest("[data-open-mobile]");
      if (openMobile) {
        event.preventDefault();
        location.href = MOBILE_URL;
      }

      const copyButton = event.target.closest("[data-copy-url]");
      if (copyButton) {
        event.preventDefault();
        copyText(copyButton.getAttribute("data-copy-url"));
      }

      if (event.target.closest("#openPwaInstallGuide")) {
        event.preventDefault();
        if (typeof openModal === "function") openModal("pwaInstallModal");
      }

      if (event.target.closest("#printPwaInstallGuide")) {
        event.preventDefault();
        window.print();
      }

      if (event.target.closest("#loginSwitchAccountBtn")) {
        event.preventDefault();
        window.forceSignOutAndShowLogin?.("switch_account");
      }
    });
  }

  function init() {
    ensureWwwDomain();
    const mobileEntry = isMobileEntry();
    if (mobileEntry) {
      document.documentElement.classList.add("pwa-mobile-entry");
      document.body.classList.add("pwa-mobile-entry");
    }
    registerServiceWorker();
    decorateMobileLogin();
    setupRememberEmail();
    renderInstallPageGuide();
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
