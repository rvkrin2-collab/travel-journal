(() => {
  const manifestHref = "/manifest.webmanifest";
  const iconHref = "/icons/icon-192.png";

  function ensureHeadLinks() {
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement("link");
      manifest.rel = "manifest";
      manifest.href = manifestHref;
      document.head.appendChild(manifest);
    }

    if (!document.querySelector('meta[name="theme-color"]')) {
      const theme = document.createElement("meta");
      theme.name = "theme-color";
      theme.content = "#263c34";
      document.head.appendChild(theme);
    }

    if (!document.querySelector('link[rel="apple-touch-icon"]')) {
      const appleIcon = document.createElement("link");
      appleIcon.rel = "apple-touch-icon";
      appleIcon.href = "/icons/apple-touch-icon.png";
      document.head.appendChild(appleIcon);
    }

    if (!document.querySelector('link[rel="icon"]')) {
      const icon = document.createElement("link");
      icon.rel = "icon";
      icon.href = iconHref;
      document.head.appendChild(icon);
    }
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function injectInstallStyles() {
    if (document.querySelector("#pwa-install-styles")) return;
    const style = document.createElement("style");
    style.id = "pwa-install-styles";
    style.textContent = `
      .pwa-install-button{position:fixed;right:16px;bottom:16px;z-index:9999;border:1px solid rgba(255,248,236,.32);border-radius:999px;padding:11px 15px;background:rgba(38,60,52,.94);color:#fff8ec;box-shadow:0 10px 28px rgba(0,0,0,.2);backdrop-filter:blur(12px);font:500 13px/1 Inter,system-ui,sans-serif;cursor:pointer}
      .pwa-install-button[hidden]{display:none}
      .pwa-install-toast{position:fixed;left:50%;bottom:78px;z-index:9999;transform:translateX(-50%);max-width:min(520px,calc(100vw - 32px));padding:10px 14px;border-radius:16px;background:#fff8ec;color:#251f19;box-shadow:0 10px 30px rgba(0,0,0,.2);font:500 13px/1.3 Inter,system-ui,sans-serif}
      @media(min-width:900px){.pwa-install-button{right:22px;bottom:22px}}
    `;
    document.head.appendChild(style);
  }

  function showToast(message) {
    const old = document.querySelector(".pwa-install-toast");
    if (old) old.remove();
    const toast = document.createElement("div");
    toast.className = "pwa-install-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function createInstallButton() {
    let button = document.querySelector("[data-pwa-install]");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "pwa-install-button";
      button.dataset.pwaInstall = "true";
      button.textContent = "Установить журнал";
      button.hidden = true;
      document.body.appendChild(button);
    }
    return button;
  }

  ensureHeadLinks();
  injectInstallStyles();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try {
        const registration = await navigator.serviceWorker.register("/service-worker.js", {scope: "/"});
        registration.update().catch(() => {});
      } catch (error) {
        console.warn("Service worker registration failed", error);
      }
    });
  }

  if (isStandalone()) return;

  const installButton = createInstallButton();
  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredPrompt) {
      showToast("Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».");
      return;
    }

    installButton.hidden = true;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installButton.hidden = true;
    showToast("Журнал установлен на устройство.");
  });
})();
