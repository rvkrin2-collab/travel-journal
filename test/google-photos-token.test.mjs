import assert from "node:assert/strict";
import test from "node:test";
import { GooglePhotosPicker } from "../google-photos-picker.js";

const key = "travel-journal-google-oauth-token-v1";
const config = { google_client_id: "client", google_photos_scope: "scope" };
const storage = values => ({ getItem: name => values.get(name) ?? null, setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) });

test("reuses a valid Google OAuth token from sessionStorage", async t => {
  const values = new Map([[key, JSON.stringify({ access_token: "cached", expires_at: Date.now() + 3_600_000 })]]);
  globalThis.sessionStorage = storage(values);
  globalThis.google = { accounts: { oauth2: { initTokenClient() { throw new Error("OAuth must not open"); } } } };
  t.after(() => { delete globalThis.google; delete globalThis.sessionStorage; });
  assert.equal(await new GooglePhotosPicker(config).token(), "cached");
});

test("renews an expired token and stores its expiration", async t => {
  const values = new Map([[key, JSON.stringify({ access_token: "old", expires_at: Date.now() - 1 })]]);
  globalThis.sessionStorage = storage(values);
  globalThis.google = { accounts: { oauth2: { initTokenClient(options) { return { requestAccessToken() { options.callback({ access_token: "fresh", expires_in: 1800 }); } }; } } } };
  t.after(() => { delete globalThis.google; delete globalThis.sessionStorage; });
  assert.equal(await new GooglePhotosPicker(config).token(), "fresh");
  const saved = JSON.parse(values.get(key));
  assert.equal(saved.access_token, "fresh");
  assert.ok(saved.expires_at > Date.now());
});
