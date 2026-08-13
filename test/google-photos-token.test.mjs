import assert from "node:assert/strict";
import test from "node:test";
import { GooglePhotosPicker } from "../google-photos-picker.js";

const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

test("reuses a valid Google OAuth token from sessionStorage", async () => {
  globalThis.sessionStorage = storage();
  sessionStorage.setItem("travel-journal-google-photos-token-v1", JSON.stringify({ access_token: "cached", expires_at: Date.now() + 60000 }));
  globalThis.google = { accounts: { oauth2: { initTokenClient: () => { throw new Error("OAuth must not open"); } } } };
  assert.equal(await new GooglePhotosPicker({}).token(), "cached");
});

test("renews an expired token and stores its expiration", async () => {
  globalThis.sessionStorage = storage();
  sessionStorage.setItem("travel-journal-google-photos-token-v1", JSON.stringify({ access_token: "old", expires_at: Date.now() - 1 }));
  let options;
  globalThis.google = { accounts: { oauth2: { initTokenClient: value => (options = value, { requestAccessToken: () => options.callback({ access_token: "fresh", expires_in: 120 }) }) } } };
  assert.equal(await new GooglePhotosPicker({ google_client_id: "client", google_photos_scope: "scope" }).token(), "fresh");
  const cached = JSON.parse(sessionStorage.getItem("travel-journal-google-photos-token-v1"));
  assert.equal(cached.access_token, "fresh");
  assert.ok(cached.expires_at > Date.now() + 100000);
});
