(() => {
  const APP_ID = "d19328c8-3ac8-4d2a-b495-3906dbca349c";
  const SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

  if (!window.isSecureContext || !("serviceWorker" in navigator) || !("Notification" in window)) return;

  const button = document.getElementById("push-subscribe-button");
  const note = document.getElementById("push-subscribe-note");

  const setState = (text, disabled = false, hidden = false) => {
    if (!button) return;
    button.textContent = text;
    button.disabled = disabled;
    button.hidden = hidden;
    if (note) note.hidden = hidden;
  };

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function(OneSignal) {
    try {
      await OneSignal.init({
        appId: APP_ID,
        serviceWorkerPath: "/service-worker.js",
        serviceWorkerParam: { scope: "/" },
        autoResubscribe: true,
        notifyButton: { enable: false }
      });

      const refresh = async () => {
        const subscribed = Boolean(OneSignal.User?.PushSubscription?.optedIn);
        if (subscribed) {
          setState("Уведомления включены", true, true);
          return;
        }
        if (!button) return;
        if (Notification.permission === "denied") {
          setState("Уведомления заблокированы", true, false);
          if (note) note.textContent = "Разрешение можно изменить в настройках приложения или браузера.";
          return;
        }
        setState("Получать новые главы", false, false);
      };

      if (button) {
        button.addEventListener("click", async () => {
          try {
            setState("Подключение…", true, false);
            const permission = await OneSignal.Notifications.requestPermission();
            if (permission) await OneSignal.User.PushSubscription.optIn();
          } catch (error) {
            console.error("OneSignal subscription failed", error);
            setState("Не удалось подключить", false, false);
          } finally {
            await refresh();
          }
        });
      }

      OneSignal.User.PushSubscription.addEventListener("change", refresh);
      OneSignal.Notifications.addEventListener("permissionChange", refresh);
      await refresh();
    } catch (error) {
      console.error("OneSignal initialization failed", error);
      if (button) setState("Уведомления недоступны", true, false);
    }
  });

  if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.defer = true;
    script.async = true;
    script.crossOrigin = "anonymous";
    document.head.appendChild(script);
  }
})();
