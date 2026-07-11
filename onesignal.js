(() => {
  const APP_ID = "d19328c8-3ac8-4d2a-b495-3906dbca349c";
  const SDK_URL = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";

  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('Notification' in window)) return;
  if (document.querySelector(`script[src="${SDK_URL}"]`)) return;

  window.OneSignalDeferred = window.OneSignalDeferred || [];
  window.OneSignalDeferred.push(async function(OneSignal) {
    await OneSignal.init({
      appId: APP_ID,
      serviceWorkerPath: "push/onesignal/OneSignalSDKWorker.js",
      serviceWorkerParam: { scope: "/push/onesignal/" },
      autoResubscribe: true,
      notifyButton: {
        enable: true,
        size: "small",
        position: "bottom-right",
        showCredit: false,
        text: {
          "tip.state.unsubscribed": "Получать новые главы",
          "tip.state.subscribed": "Уведомления включены",
          "tip.state.blocked": "Уведомления заблокированы",
          "message.prenotify": "Нажмите, чтобы получать новые главы",
          "message.action.subscribed": "Уведомления включены",
          "message.action.resubscribed": "Уведомления снова включены",
          "message.action.unsubscribed": "Уведомления отключены",
          "dialog.main.title": "Уведомления о новых главах",
          "dialog.main.button.subscribe": "Получать",
          "dialog.main.button.unsubscribe": "Отключить",
          "dialog.blocked.title": "Уведомления заблокированы",
          "dialog.blocked.message": "Разрешите уведомления для owntravel.ru в настройках браузера."
        }
      },
      promptOptions: {
        slidedown: {
          prompts: [{
            type: "push",
            autoPrompt: true,
            delay: {
              pageViews: 1,
              timeDelay: 3
            },
            text: {
              actionMessage: "Получать уведомления о новых главах?",
              acceptButton: "Получать",
              cancelButton: "Не сейчас"
            }
          }]
        }
      },
      welcomeNotification: {
        title: "Журнал путешествий",
        message: "Уведомления о новых главах включены.",
        url: "https://owntravel.ru/"
      }
    });
  });

  const script = document.createElement('script');
  script.src = SDK_URL;
  script.defer = true;
  script.async = true;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
})();
