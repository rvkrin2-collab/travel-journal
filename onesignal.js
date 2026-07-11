(() => {
  const APP_ID = "d19328c8-3ac8-4d2a-b495-3906dbca349c";
  const SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("Notification" in window)) return;
  if (document.querySelector(`script[src="${SDK_URL}"]`)) return;

  const addStyles = () => {
    if (document.getElementById("travel-push-styles")) return;
    const style = document.createElement("style");
    style.id = "travel-push-styles";
    style.textContent = `
      .travel-push-button{position:fixed;right:16px;bottom:16px;z-index:70;display:inline-flex;align-items:center;gap:9px;border:1px solid rgba(255,248,236,.34);border-radius:999px;padding:11px 15px;background:rgba(38,60,52,.94);color:#fff8ec;box-shadow:0 8px 30px rgba(0,0,0,.2);backdrop-filter:blur(12px);font:500 13px/1.1 Inter,system-ui,sans-serif;cursor:pointer}
      .travel-push-button[hidden]{display:none}.travel-push-button:disabled{cursor:default;opacity:.8}.travel-push-button__icon{font-size:16px;line-height:1}
      @media(min-width:900px){.travel-push-button{right:22px;bottom:22px}}
    `;
    document.head.appendChild(style);
  };

  const createButton = () => {
    addStyles();
    let button = document.getElementById("travel-push-button");
    if (button) return button;
    button = document.createElement("button");
    button.id = "travel-push-button";
    button.className = "travel-push-button";
    button.type = "button";
    button.innerHTML = '<span class="travel-push-button__icon" aria-hidden="true">🔔</span><span class="travel-push-button__label">Получать новые главы</span>';
    button.setAttribute("aria-label", "Получать уведомления о новых главах");
    document.body.appendChild(button);
    return button;
  };

  const setButtonState = (button, subscribed, blocked = false) => {
    const label = button.querySelector(".travel-push-button__label");
    if (blocked) {
      label.textContent = "Уведомления заблокированы";
      button.disabled = true;
      return;
    }
    button.disabled = false;
    label.textContent = subscribed ? "Уведомления включены" : "Получать новые главы";
  };

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function(OneSignal) {
    await OneSignal.init({
      appId: APP_ID,
      serviceWorkerPath: "/push/onesignal/OneSignalSDKWorker.js",
      serviceWorkerParam: { scope: "/push/onesignal/" },
      autoResubscribe: true,
      notifyButton: { enable: false },
      welcomeNotification: {
        title: "Журнал путешествий",
        message: "Уведомления о новых главах включены.",
        url: "https://owntravel.ru/"
      }
    });

    const button = createButton();

    const refresh = async () => {
      const blocked = Notification.permission === "denied";
      const subscribed = Boolean(OneSignal.User?.PushSubscription?.optedIn);
      setButtonState(button, subscribed, blocked);
    };

    button.addEventListener("click", async () => {
      try {
        button.disabled = true;
        const permission = await OneSignal.Notifications.requestPermission();
        if (permission) await OneSignal.User.PushSubscription.optIn();
      } catch (error) {
        console.error("OneSignal subscription failed", error);
      } finally {
        await refresh();
      }
    });

    OneSignal.User.PushSubscription.addEventListener("change", refresh);
    OneSignal.Notifications.addEventListener("permissionChange", refresh);
    await refresh();
  });

  const script = document.createElement("script");
  script.src = SDK_URL;
  script.defer = true;
  script.async = true;
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
})();
