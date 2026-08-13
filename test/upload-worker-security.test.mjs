import assert from "node:assert/strict";
import test from "node:test";
import worker, { authorize } from "../worker/src/index.js";

const originalFetch = globalThis.fetch;
const scope = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";

function request() {
  return new Request("https://upload.example.test/upload", {
    headers: { Authorization: "Bearer test-token" }
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("upload authorization requires a configured author allowlist", async () => {
  globalThis.fetch = async () => Response.json({ aud: "client-id", sub: "author-1", scope });
  await assert.rejects(authorize(request(), { GOOGLE_CLIENT_ID: "client-id" }), error => error instanceof Response && error.status === 503);
});

test("upload authorization rejects another Google account", async () => {
  globalThis.fetch = async () => Response.json({ aud: "client-id", sub: "intruder", scope });
  await assert.rejects(authorize(request(), {
    GOOGLE_CLIENT_ID: "client-id",
    ALLOWED_GOOGLE_USER_IDS: "author-1"
  }), error => error instanceof Response && error.status === 403);
});

test("upload authorization accepts an allowlisted Google account", async () => {
  globalThis.fetch = async () => Response.json({ aud: "client-id", sub: "author-1", scope });
  const identity = await authorize(request(), {
    GOOGLE_CLIENT_ID: "client-id",
    ALLOWED_GOOGLE_USER_IDS: "author-1,author-2"
  });
  assert.equal(identity.sub, "author-1");
});

test("Google import rejects non-Google source URLs before downloading", async () => {
  globalThis.fetch = async url => {
    if (String(url).startsWith("https://oauth2.googleapis.com/")) return Response.json({ aud: "client-id", sub: "author-1", scope });
    throw new Error("unexpected download");
  };
  const response = await worker.fetch(new Request("https://upload.example.test/import", {
    method: "POST",
    headers: { Origin: "https://owntravel.ru", Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ source_url: "https://evil.example/photo.jpg" })
  }), { GOOGLE_CLIENT_ID: "client-id", ALLOWED_GOOGLE_USER_IDS: "author-1", ALLOWED_ORIGIN: "https://owntravel.ru" });
  assert.equal(response.status, 400);
});
