const API = "https://photospicker.googleapis.com/v1";
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const TOKEN_KEY = "travel-journal-google-photos-token-v1";
const TOKEN_EXPIRY_MARGIN = 30000;

async function googleRequest(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers } });
  if (!response.ok) throw new Error(`Google Photos API: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export class GooglePhotosPicker {
  constructor(config) { this.config = config; }

  token() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || "null");
      if (cached?.access_token && cached.expires_at > Date.now() + TOKEN_EXPIRY_MARGIN) return Promise.resolve(cached.access_token);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {}
    return new Promise((resolve, reject) => {
      const wait = deadline => {
        if (globalThis.google?.accounts?.oauth2) {
          google.accounts.oauth2.initTokenClient({ client_id: this.config.google_client_id, scope: this.config.google_photos_scope,
            callback: response => {
              if (response.error) return reject(new Error(response.error));
              try {
                sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: response.access_token, expires_at: Date.now() + Number(response.expires_in || 3600) * 1000 }));
              } catch {}
              resolve(response.access_token);
            },
            error_callback: error => reject(new Error(error.type || "Google OAuth error")) }).requestAccessToken({ prompt: "consent" });
        } else if (Date.now() < deadline) setTimeout(() => wait(deadline), 100);
        else reject(new Error("Google Sign-In не загрузился"));
      };
      wait(Date.now() + 10000);
    });
  }

  async identify() {
    const token = await this.token();
    const response = await fetch(`${this.config.upload_api_url}/whoami`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Проверка аккаунта: HTTP ${response.status}`);
    return response.json();
  }

  async pick({ tripId, chapterId, onProgress }) {
    const token = await this.token();
    const session = await googleRequest(`${API}/sessions`, token, { method: "POST", body: "{}" });
    const popup = open(session.pickerUri, "google-photos-picker", "popup=yes,width=900,height=720");
    if (!popup) throw new Error("Разрешите всплывающие окна для выбора фотографий");
    onProgress("Выберите фотографии и нажмите «Готово»…");
    let current = session;
    const interval = Math.max(1000, Number(session.pollingConfig?.pollInterval?.replace("s", "")) * 1000 || 2000);
    while (!current.mediaItemsSet) { await sleep(interval); current = await googleRequest(`${API}/sessions/${encodeURIComponent(session.id)}`, token); }
    popup.close();
    const items = [];
    let pageToken = "";
    do {
      const query = new URLSearchParams({ sessionId: session.id, pageSize: "100" });
      if (pageToken) query.set("pageToken", pageToken);
      const page = await googleRequest(`${API}/mediaItems?${query}`, token);
      items.push(...(page.mediaItems || []));
      pageToken = page.nextPageToken || "";
    } while (pageToken);
    const uploaded = [];
    for (const [index, item] of items.entries()) {
      onProgress(`Копируем ${index + 1} из ${items.length}…`);
      const media = item.mediaFile || {};
      const response = await fetch(`${this.config.upload_api_url}/import`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ source_url: media.baseUrl, name: media.filename, mime_type: media.mimeType, trip: tripId, chapter: chapterId, google_media_item_id: item.id }) });
      if (!response.ok) throw new Error(`Загрузка ${media.filename || index + 1}: HTTP ${response.status}`);
      uploaded.push(await response.json());
    }
    await googleRequest(`${API}/sessions/${encodeURIComponent(session.id)}`, token, { method: "DELETE" });
    return uploaded;
  }
}
