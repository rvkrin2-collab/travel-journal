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
