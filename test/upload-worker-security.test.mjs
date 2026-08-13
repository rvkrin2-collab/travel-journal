import assert from "node:assert/strict";
import test from "node:test";
import worker, { authorize } from "../worker/src/index.js";

const originalFetch = globalThis.fetch;
const scope = "https://www.googleapis.com/auth/photospicker.mediaitems.readonly https://www.googleapis.com/auth/userinfo.email";

function request() {
  return new Request("https://upload.example.test/upload", {
    headers: { Authorization: "Bearer test-token" }
  });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("upload authorization requires a configured author allowlist", async () => {
  globalThis.fetch = async () => Response.json({ aud: "client-id", email: "author@example.com", email_verified: "true", scope });
  await assert.rejects(authorize(request(), { GOOGLE_CLIENT_ID: "client-id" }), error => error instanceof Response && error.status === 503);
});

test("upload authorization rejects another Google account", async () => {
  globalThis.fetch = async () => Response.json({ aud: "client-id", email: "intruder@example.com", email_verified: "true", scope });
  await assert.rejects(authorize(request(), {
    GOOGLE_CLIENT_ID: "client-id",
    ALLOWED_GOOGLE_EMAILS: "author@example.com"
  }), error => error instanceof Response && error.status === 403);
});

test("upload authorization accepts an allowlisted Google account", async () => {
  globalThis.fetch = async () => Response.json({ aud: "client-id", email: "author@example.com", email_verified: "true", scope });
  const identity = await authorize(request(), {
    GOOGLE_CLIENT_ID: "client-id",
    ALLOWED_GOOGLE_EMAILS: "author@example.com,editor@example.com"
  });
  assert.equal(identity.email, "author@example.com");
});

test("whoami returns the verified Google email before allowlist setup", async () => {
  globalThis.fetch = async () => Response.json({ aud: "client-id", email: "author@example.com", email_verified: "true", scope });
  const response = await worker.fetch(new Request("https://upload.example.test/whoami", {
    headers: { Origin: "https://owntravel.ru", Authorization: "Bearer test-token" }
  }), { GOOGLE_CLIENT_ID: "client-id", ALLOWED_ORIGIN: "https://owntravel.ru" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { google_email: "author@example.com" });
});

test("whoami rejects a token without a verified email", async () => {
  globalThis.fetch = async () => Response.json({ aud: "client-id", scope });
  const response = await worker.fetch(new Request("https://upload.example.test/whoami", {
    headers: { Origin: "https://owntravel.ru", Authorization: "Bearer test-token" }
  }), { GOOGLE_CLIENT_ID: "client-id", ALLOWED_ORIGIN: "https://owntravel.ru" });
  assert.equal(response.status, 422);
});

test("Google import rejects non-Google source URLs before downloading", async () => {
  globalThis.fetch = async url => {
    if (String(url).startsWith("https://oauth2.googleapis.com/")) return Response.json({ aud: "client-id", email: "author@example.com", email_verified: "true", scope });
    throw new Error("unexpected download");
  };
  const response = await worker.fetch(new Request("https://upload.example.test/import", {
    method: "POST",
    headers: { Origin: "https://owntravel.ru", Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ source_url: "https://evil.example/photo.jpg" })
  }), { GOOGLE_CLIENT_ID: "client-id", ALLOWED_GOOGLE_EMAILS: "author@example.com", ALLOWED_ORIGIN: "https://owntravel.ru" });
  assert.equal(response.status, 400);
});

test("author workshop submission dispatches the editorial workflow", async () => {
  let dispatch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/")) return Response.json({ aud: "client-id", email: "author@example.com", email_verified: "true", scope });
    if (String(url).includes("api.github.com/repos/owner/repo/dispatches")) { dispatch = JSON.parse(options.body); return new Response(null, { status: 204 }); }
    throw new Error(`unexpected URL: ${url}`);
  };
  const trip = "sample-trip"; const chapter = "coast"; const key = `${trip}/${chapter}/photo.jpg`;
  const response = await worker.fetch(new Request("https://upload.example.test/submit", {
    method: "POST",
    headers: { Origin: "https://owntravel.ru", Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ schema_version: 1, type: "new_trip_request", trip: { id: trip, title: "Sample" }, chapters: [{ id: chapter, title: "Coast", photos: [{ key, url: `https://photos.owntravel.ru/${key}` }] }] })
  }), { GOOGLE_CLIENT_ID: "client-id", ALLOWED_GOOGLE_EMAILS: "author@example.com", ALLOWED_ORIGIN: "https://owntravel.ru", GITHUB_DISPATCH_TOKEN: "secret", GITHUB_REPOSITORY: "owner/repo" });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status_url, "https://owntravel.ru/submission.html?trip=sample-trip");
  assert.equal(dispatch.event_type, "author_trip_submitted");
  assert.equal(dispatch.client_payload.request.trip.id, trip);
});
