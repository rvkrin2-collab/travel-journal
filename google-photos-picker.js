const API = "https://photospicker.googleapis.com/v1";
const TOKEN_KEY = "travel-journal-google-oauth-token-v1";
const EXPIRY_MARGIN_MS = 60 * 1000;
const AUTHOR_SESSION_KEY = "travel-journal-author-session-v1";
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function googleRequest(url, token, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers } });
  if (!response.ok) throw new Error(`Google Photos API: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

export class GooglePhotosPicker {
  constructor(config) {
    this.config = config;
    this.accessToken = null;
    this.tokenRequest = null;
    this.authorizedThisSession = false;
    this.statusReporter = null;
  }

  setStatusReporter(reporter) {
    this.statusReporter = typeof reporter === "function" ? reporter : null;
    return this;
  }

  report(state, message, detail = {}) {
    try { this.statusReporter?.({ state, message, ...detail }); } catch {}
  }

  hasRequiredScopes(value) {
    const required = new Set(String(this.config.google_photos_scope || "").split(/\s+/).filter(Boolean));
    const granted = new Set(String(value || "").split(/\s+/).filter(Boolean));
    return [...required].every(scope => granted.has(scope));
  }

  cachedToken() {
    if (this.accessToken?.expires_at > Date.now() + EXPIRY_MARGIN_MS && this.hasRequiredScopes(this.accessToken.scope)) return this.accessToken.access_token;
    try {
      const saved = JSON.parse(globalThis.sessionStorage?.getItem(TOKEN_KEY) || "null");
      const accessToken = saved?.access_token || saved?.value || "";
      const expiresAt = Number(saved?.expires_at ?? saved?.expiresAt) || 0;
      if (accessToken && expiresAt > Date.now() + EXPIRY_MARGIN_MS && this.hasRequiredScopes(saved?.scope)) {
        this.accessToken = { access_token: accessToken, expires_at: expiresAt, scope: saved.scope };
        this.authorizedThisSession = true;
        return accessToken;
      }
      if (accessToken) this.authorizedThisSession = true;
      globalThis.sessionStorage?.removeItem(TOKEN_KEY);
    } catch {}
    return "";
  }

  rememberToken(response) {
    const expiresIn = Math.max(0, Number(response.expires_in) || 3600);
    this.accessToken = { access_token: response.access_token, expires_at: Date.now() + expiresIn * 1000, scope: response.scope || this.config.google_photos_scope };
    this.authorizedThisSession = true;
    try { globalThis.sessionStorage?.setItem(TOKEN_KEY, JSON.stringify(this.accessToken)); } catch {}
    return this.accessToken.access_token;
  }

  token(force = false) {
    if (force) {
      this.accessToken = null;
      try { globalThis.sessionStorage?.removeItem(TOKEN_KEY); } catch {}
    }
    const cached = this.cachedToken();
    if (cached) return Promise.resolve(cached);
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = new Promise((resolve, reject) => {
      const wait = deadline => {
        if (globalThis.google?.accounts?.oauth2) {
          google.accounts.oauth2.initTokenClient({ client_id: this.config.google_client_id, scope: this.config.google_photos_scope,
            callback: response => response.error ? reject(new Error(response.error)) : resolve(this.rememberToken(response)),
            error_callback: error => reject(new Error(error.type || "Google OAuth error")) }).requestAccessToken({ prompt: force || !this.authorizedThisSession ? "consent" : "" });
        } else if (Date.now() < deadline) setTimeout(() => wait(deadline), 100);
        else reject(new Error("Google Sign-In не загрузился"));
      };
      wait(Date.now() + 10000);
    }).finally(() => { this.tokenRequest = null; });
    return this.tokenRequest;
  }

  async identify() {
    try {
      this.report("authorizing", "Проверяем Google-аккаунт…");
      const request = token => fetch(`${this.config.upload_api_url}/whoami`, { headers: { Authorization: `Bearer ${token}` } });
      let response = await request(await this.token());
      if ([401, 403, 422].includes(response.status)) {
        this.report("auth_required", "Нужно подтвердить Google-аккаунт ещё раз.");
        response = await request(await this.token(true));
      }
      const fallback = response.clone();
      const result = await response.json().catch(async () => ({ error: await fallback.text().catch(() => "") }));
      if (!response.ok) throw new Error(result.error || `Проверка аккаунта: HTTP ${response.status}`);
      this.report("authorized", "Google-аккаунт подтверждён.", { result });
      return result;
    } catch (error) {
      this.report("error", `Не удалось подтвердить Google-аккаунт: ${error.message}`);
      throw error;
    }
  }

  rememberAuthorSession(result) {
    if (!result?.author_session) return;
    const session = JSON.stringify({ token: result.author_session, expires_at: Date.now() + Number(result.author_session_expires_in || 0) * 1000 });
    try { sessionStorage.setItem(AUTHOR_SESSION_KEY, session); } catch {}
    try { globalThis.localStorage?.setItem(AUTHOR_SESSION_KEY, session); } catch {}
  }

  clearAuthorSession() {
    try { sessionStorage.removeItem(AUTHOR_SESSION_KEY); } catch {}
    try { globalThis.localStorage?.removeItem(AUTHOR_SESSION_KEY); } catch {}
  }

  async submit(request) {
    try {
      this.report("authorizing", "Проверяем авторизацию Google…", { label: "Отправка путешествия" });
      const token = await this.token();
      this.report("sending", "Отправляем путешествие в редакционный процесс…", { label: "Отправка путешествия" });
      const response = await fetch(`${this.config.upload_api_url}/submit`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const fallback = response.clone();
      const result = await response.json().catch(async () => ({ error: await fallback.text().catch(() => "") }));
      if (!response.ok) throw new Error(result.error || `Отправка заявки: HTTP ${response.status}`);
      this.rememberAuthorSession(result);
      this.report("accepted", "Команда принята. Обработка путешествия запущена.", { label: "Отправка путешествия", result });
      return result;
    } catch (error) {
      this.report("error", `Не удалось отправить путешествие: ${error.message}`, { label: "Отправка путешествия" });
      throw error;
    }
  }

  authorSession() {
    try {
      const value = JSON.parse(sessionStorage.getItem(AUTHOR_SESSION_KEY) || globalThis.localStorage?.getItem(AUTHOR_SESSION_KEY) || "null");
      if (value?.token && Number(value.expires_at) > Date.now() + EXPIRY_MARGIN_MS) return value.token;
    } catch {}
    this.clearAuthorSession();
    return "";
  }

  async editorialPost(path, body, label) {
    const request = authorization => fetch(`${this.config.upload_api_url}${path}`, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      let session = this.authorSession();
      let usingGoogle = !session;
      let response;
      if (session) {
        this.report("sending", `Отправляем команду: ${label}…`, { label });
        response = await request(`Session ${session}`);
      } else {
        this.report("auth_required", `Для действия «${label}» нужна авторизация. Открываем Google…`, { label });
        const token = await this.token();
        this.report("authorized", "Авторизация подтверждена. Отправляем команду…", { label });
        response = await request(`Bearer ${token}`);
      }
      if (response.status === 401 && session) {
        this.clearAuthorSession();
        usingGoogle = true;
        this.report("auth_required", "Сеанс автора закончился. Подтвердите Google-аккаунт — исходная команда будет отправлена автоматически.", { label });
        const token = await this.token();
        this.report("authorized", "Авторизация подтверждена. Повторяем исходную команду…", { label });
        response = await request(`Bearer ${token}`);
      }
      if ([401, 403, 422].includes(response.status) && usingGoogle) {
        this.report("auth_required", "Google просит подтвердить аккаунт ещё раз. После входа команда продолжится автоматически.", { label });
        const token = await this.token(true);
        this.report("authorized", "Авторизация подтверждена. Повторяем исходную команду…", { label });
        response = await request(`Bearer ${token}`);
      }
      const fallback = response.clone();
      const result = await response.json().catch(async () => ({ error: await fallback.text().catch(() => "") }));
      if (!response.ok) throw new Error(result.error || `${label}: HTTP ${response.status}`);
      this.rememberAuthorSession(result);
      this.report("accepted", `Команда «${label}» принята сервером.`, { label, result });
      return result;
    } catch (error) {
      this.report("error", `Команда «${label}» не выполнена: ${error.message}`, { label });
      throw error;
    }
  }

  approvePhotos(review) { return this.editorialPost("/approve-photos", review, "Утверждение фотографий"); }
  approvePreview(approval) { return this.editorialPost("/approve-preview", approval, "Утверждение preview"); }
  submitPreviewFeedback(feedback) { return this.editorialPost("/preview-feedback", feedback, "Отправка замечания"); }
  publishTrip(request) { return this.editorialPost("/publish", request, "Публикация"); }
  retryProcessing(trip) { return this.editorialPost("/retry-processing", { trip }, "Повторный запуск"); }

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
