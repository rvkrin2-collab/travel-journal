import assert from "node:assert/strict";
import test from "node:test";
import worker, { authorize, createAuthorSession } from "../worker/src/index.js";

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

test("trip submission explains an R2 path mismatch as JSON", async () => {
  globalThis.fetch = async url => {
    if (String(url).startsWith("https://oauth2.googleapis.com/")) return Response.json({ aud: "client-id", email: "author@example.com", email_verified: "true", scope });
    throw new Error(`unexpected URL: ${url}`);
  };
  const response = await worker.fetch(new Request("https://upload.example.test/submit", {
    method: "POST",
    headers: { Origin: "https://owntravel.ru", Authorization: "Bearer test-token", "Content-Type": "application/json" },
    body: JSON.stringify({ schema_version: 1, type: "new_trip_request", trip: { id: "new-title", title: "New title" }, chapters: [{ id: "coast", title: "Coast", photos: [{ key: "old-title/coast/photo.jpg", url: "https://photos.owntravel.ru/old-title/coast/photo.jpg" }] }] })
  }), { GOOGLE_CLIENT_ID: "client-id", ALLOWED_GOOGLE_EMAILS: "author@example.com", ALLOWED_ORIGIN: "https://owntravel.ru", GITHUB_DISPATCH_TOKEN: "secret", GITHUB_REPOSITORY: "owner/repo" });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Photo is outside this chapter R2 path" });
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
  }), { GOOGLE_CLIENT_ID: "client-id", ALLOWED_GOOGLE_EMAILS: "author@example.com", ALLOWED_ORIGIN: "https://owntravel.ru", GITHUB_DISPATCH_TOKEN: "secret", GITHUB_REPOSITORY: "owner/repo", AUTHOR_SESSION_SECRET: "a-secure-test-secret-with-more-than-32-bytes" });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status_url, "https://owntravel.ru/submission.html?trip=sample-trip");
  assert.equal(dispatch.event_type, "author_trip_submitted");
  assert.equal(dispatch.client_payload.request.trip.id, trip);
  assert.ok(body.author_session);
});

test("stalled processing can be retried without uploading photos again", async () => {
  let dispatch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/")) return Response.json({ aud: "client-id", email: "author@example.com", email_verified: "true", scope });
    if (String(url).includes("api.github.com/repos/owner/repo/dispatches")) { dispatch = JSON.parse(options.body); return new Response(null, { status: 204 }); }
    throw new Error(`unexpected URL: ${url}`);
  };
  const response = await worker.fetch(new Request("https://upload.example.test/retry-processing", { method: "POST", headers: { Origin: "https://owntravel.ru", Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: JSON.stringify({ trip: "sample-trip" }) }), { GOOGLE_CLIENT_ID: "client-id", ALLOWED_GOOGLE_EMAILS: "author@example.com", ALLOWED_ORIGIN: "https://owntravel.ru", GITHUB_DISPATCH_TOKEN: "secret", GITHUB_REPOSITORY: "owner/repo" });
  assert.equal(response.status, 202);
  assert.equal(dispatch.event_type, "trip_processing_retry");
  assert.deepEqual(dispatch.client_payload, { artifact: { trip: "sample-trip" } });
});

test("approved photo selection dispatches storyboard automation", async () => {
  let dispatch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith("https://oauth2.googleapis.com/")) return Response.json({ aud: "client-id", email: "author@example.com", email_verified: "true", scope });
    dispatch = JSON.parse(options.body); return new Response(null, { status: 204 });
  };
  const artifact = { schema_version: 2, trip: "sample-trip", chapter: "coast", approval: "photo_selection_approved", photos_fingerprint: "abc", items: [{ photo_id: "one", status: "hero", label: "Coast" }] };
  const env = { ALLOWED_ORIGIN: "https://owntravel.ru", GITHUB_DISPATCH_TOKEN: "secret", GITHUB_REPOSITORY: "owner/repo", AUTHOR_SESSION_SECRET: "a-secure-test-secret-with-more-than-32-bytes" };
  const session = await createAuthorSession("author@example.com", env);
  const response = await worker.fetch(new Request("https://upload.example.test/approve-photos", { method: "POST", headers: { Origin: "https://owntravel.ru", Authorization: `Session ${session}`, "Content-Type": "application/json" }, body: JSON.stringify(artifact) }), env);
  assert.equal(response.status, 202);
  assert.equal(dispatch.event_type, "photo_selection_approved");
});

test("explicit publication dispatch uses the signed author session", async () => {
  let dispatch;
  globalThis.fetch = async (_url, options = {}) => {
    dispatch = JSON.parse(options.body);
    return new Response(null, { status: 204 });
  };
  const env = { ALLOWED_ORIGIN: "https://owntravel.ru", GITHUB_DISPATCH_TOKEN: "secret", GITHUB_REPOSITORY: "owner/repo", AUTHOR_SESSION_SECRET: "a-secure-test-secret-with-more-than-32-bytes" };
  const session = await createAuthorSession("author@example.com", env);
  const response = await worker.fetch(new Request("https://upload.example.test/publish", {
    method: "POST",
    headers: { Origin: "https://owntravel.ru", Authorization: `Session ${session}`, "Content-Type": "application/json" },
    body: JSON.stringify({ trip: "sample-trip", status: "publish_requested", cover_chapter: "coast" })
  }), env);
  assert.equal(response.status, 202);
  assert.equal(dispatch.event_type, "publish_requested");
  assert.equal(dispatch.client_payload.artifact.cover_chapter, "coast");
});

test("editorial approval rejects a Google token when no author session is supplied", async () => {
  const response = await worker.fetch(new Request("https://upload.example.test/approve-preview", { method: "POST", headers: { Origin: "https://owntravel.ru", Authorization: "Bearer google-token", "Content-Type": "application/json" }, body: "{}" }), { ALLOWED_ORIGIN: "https://owntravel.ru", AUTHOR_SESSION_SECRET: "a-secure-test-secret-with-more-than-32-bytes", GITHUB_DISPATCH_TOKEN: "secret", GITHUB_REPOSITORY: "owner/repo" });
  assert.equal(response.status, 401);
});

test("R2 media fallback serves an uploaded image to the editor", async () => {
  const response = await worker.fetch(new Request("https://upload.example.test/media/trip/chapter/photo.jpg"), { PHOTOS: { get: async key => key === "trip/chapter/photo.jpg" ? { body: new Uint8Array([1, 2, 3]), httpEtag: '"etag"', writeHttpMetadata(headers) { headers.set("Content-Type", "image/jpeg"); } } : null } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/jpeg");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});

test("thumbnail endpoint requests a resized cached image", async () => {
  let options;
  globalThis.fetch = async (_url, value) => { options = value; return new Response(new Uint8Array([1]), { headers: { "Content-Type": "image/webp" } }); };
  const response = await worker.fetch(new Request("https://upload.example.test/thumbnail/trip/chapter/photo.jpg?w=640"), { PUBLIC_BASE_URL: "https://photos.example.test", PHOTOS: { get: async () => null } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/webp");
  assert.equal(options.cf.image.width, 720);
  assert.equal(options.cf.image.quality, 72);
});
