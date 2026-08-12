const PICKER_API = "https://photospicker.googleapis.com/v1";

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function request(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers }
  });
  if (!response.ok) throw new Error(`Google Photos Picker: HTTP ${response.status}`);
  return response.json();
}

function accessToken(clientId, scope) {
  return new Promise((resolve, reject) => {
    if (!globalThis.google?.accounts?.oauth2) return reject(new Error("Google OAuth ещё не загружен"));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback: response => response.error ? reject(new Error(response.error)) : resolve(response.access_token),
      error_callback: error => reject(new Error(error.type || "Google OAuth отменён"))
    });
    client.requestAccessToken({ prompt: "consent" });
  });
}

async function waitForSelection(sessionId, token) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const session = await request(`${PICKER_API}/sessions/${encodeURIComponent(sessionId)}`, token);
    if (session.mediaItemsSet) return;
    await sleep(2000);
  }
  throw new Error("Время выбора фотографий истекло");
}

async function listMediaItems(sessionId, token) {
  const items = [];
  let pageToken = "";
  do {
    const query = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) query.set("pageToken", pageToken);
    const page = await request(`${PICKER_API}/mediaItems?${query}`, token);
    items.push(...(page.mediaItems || []));
    pageToken = page.nextPageToken || "";
  } while (pageToken);
  return items;
}

export function createGooglePhotosPicker() {
  return {
    async pick({ trip, chapter }) {
      const config = await fetch("./config/photo-services.json", { cache: "no-store" }).then(response => response.json());
      const token = await accessToken(config.google_client_id, config.google_photos_scope);
      const session = await request(`${PICKER_API}/sessions`, token, { method: "POST", body: "{}" });
      const popup = window.open(session.pickerUri, "google-photos-picker", "popup,width=760,height=760");
      if (!popup) throw new Error("Разрешите всплывающие окна для выбора фотографий");
      await waitForSelection(session.id, token);
      popup.close();
      const mediaItems = await listMediaItems(session.id, token);
      const response = await fetch(`${config.upload_api_url.replace(/\/$/, "")}/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ trip, chapter, mediaItems: mediaItems.map(item => ({ id: item.id, baseUrl: item.mediaFile?.baseUrl, filename: item.mediaFile?.filename, mimeType: item.mediaFile?.mimeType })) })
      });
      if (!response.ok) throw new Error(`Импорт фотографий: HTTP ${response.status}`);
      return (await response.json()).photos;
    }
  };
}
