import assert from "node:assert/strict";
import test from "node:test";
import { GooglePhotosPicker } from "../google-photos-picker.js";

const config = { google_client_id: "client", google_photos_scope: "scope" };

function installGoogle(responses) {
  const prompts = [];
  globalThis.google = { accounts: { oauth2: { initTokenClient(options) {
    return { requestAccessToken(request) { prompts.push(request.prompt); options.callback(responses.shift()); } };
  } } } };
  return prompts;
}

function installSessionStorage() {
  const values = new Map();
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test("reuses one Google access token throughout a browser session", async t => {
  t.after(() => { delete globalThis.google; delete globalThis.sessionStorage; });
  installSessionStorage();
  const prompts = installGoogle([{ access_token: "first", expires_in: 3600 }]);
  assert.equal(await new GooglePhotosPicker(config).token(), "first");
  assert.equal(await new GooglePhotosPicker(config).token(), "first");
  assert.deepEqual(prompts, ["consent"]);
});

test("requests a new token when the saved token is expired", async t => {
  t.after(() => { delete globalThis.google; delete globalThis.sessionStorage; });
  installSessionStorage();
  sessionStorage.setItem("travel-journal-google-oauth-token-v1", JSON.stringify({ access_token: "old", expires_at: Date.now() - 1 }));
  const prompts = installGoogle([{ access_token: "fresh", expires_in: 3600 }]);
  assert.equal(await new GooglePhotosPicker(config).token(), "fresh");
  assert.deepEqual(prompts, [""]);
});

test("editorial approvals reuse the signed author session without Google OAuth", async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; delete globalThis.google; delete globalThis.sessionStorage; });
  installSessionStorage();
  const prompts = installGoogle([{ access_token: "google-once", expires_in: 3600 }]);
  const headers = [];
  globalThis.fetch = async (_url, options = {}) => {
    headers.push(options.headers?.Authorization);
    if (headers.length === 1) return Response.json({ accepted: true, author_session: "signed.session", author_session_expires_in: 3600, chapters: [] }, { status: 202 });
    return Response.json({ accepted: true }, { status: 202 });
  };
  const picker = new GooglePhotosPicker({ ...config, upload_api_url: "https://upload.example" });
  await picker.submit({ trip: { id: "trip" }, chapters: [] });
  delete globalThis.google;
  await picker.approvePhotos({ trip: "trip", chapter: "chapter" });
  await picker.approvePreview({ trip: "trip", chapter: "chapter" });
  assert.deepEqual(prompts, ["consent"]);
  assert.deepEqual(headers, ["Bearer google-once", "Session signed.session", "Session signed.session"]);
});
