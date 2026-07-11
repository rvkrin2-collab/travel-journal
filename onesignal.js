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
      serviceWorkerParam: { scope: "/push/onesignal/" }
    });
  });

  const script = document.createElement('script');
  script.src = SDK_URL;
  script.defer = true;
  script.async = true;
  script.crossOrigin = 'anonymous';
  document.head.appendChild(script);
})();
