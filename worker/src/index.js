const MAX_FILE_SIZE = 30 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_REQUEST_SIZE = 1024 * 1024;

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin === allowedOrigin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}

function safeSegment(value, fallback) {
  const result = String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return result || fallback;
}

export async function verifyGoogleToken(request, env) {
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Response("Missing bearer token", { status: 401 });
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Response("Invalid Google token", { status: 401 });
  const info = await response.json();
  if (info.aud !== env.GOOGLE_CLIENT_ID) throw new Response("Wrong token audience", { status: 403 });
  const scopes = new Set(String(info.scope || "").split(/\s+/));
  if (!scopes.has("https://www.googleapis.com/auth/photospicker.mediaitems.readonly")) throw new Response("Missing Picker scope", { status: 403 });
  return info;
}

export async function authorize(request, env) {
  const info = await verifyGoogleToken(request, env);
  const allowedEmails = new Set(String(env.ALLOWED_GOOGLE_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  const email = String(info.email || "").toLowerCase();
  if (!allowedEmails.size) throw new Response("Uploader email allowlist is not configured", { status: 503 });
  if (!email || info.email_verified === "false" || !allowedEmails.has(email)) throw new Response("Google account is not allowed", { status: 403 });
  return info;
}

async function upload(request, env, cors) {
  await authorize(request, env);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "file is required" }, 400, cors);
  if (!ALLOWED_TYPES.has(file.type)) return json({ error: "unsupported image type" }, 415, cors);
  if (file.size < 1 || file.size > MAX_FILE_SIZE) return json({ error: "file must be between 1 byte and 30 MB" }, 413, cors);
  const trip = safeSegment(form.get("trip"), "unassigned");
  const chapter = safeSegment(form.get("chapter"), "chapter");
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" })[file.type];
  const key = `${trip}/${chapter}/${crypto.randomUUID()}.${extension}`;
  await env.PHOTOS.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: file.name.slice(0, 200) } });
  return json({ key, url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`, size: file.size, type: file.type }, 201, cors);
}

async function importGooglePhoto(request, env, cors) {
  await authorize(request, env);
  const token = request.headers.get("Authorization").replace(/^Bearer\s+/i, "");
  const input = await request.json();
  let source;
  try { source = new URL(input.source_url); } catch { return json({ error: "invalid source URL" }, 400, cors); }
  if (source.protocol !== "https:" || !(source.hostname === "googleusercontent.com" || source.hostname.endsWith(".googleusercontent.com"))) return json({ error: "source is not Google Photos" }, 400, cors);
  const downloaded = await fetch(`${source}=d`, { headers: { Authorization: `Bearer ${token}` } });
  if (!downloaded.ok) return json({ error: "Google photo download failed" }, 502, cors);
  const type = (downloaded.headers.get("Content-Type") || input.mime_type || "").split(";")[0];
  if (!ALLOWED_TYPES.has(type)) return json({ error: "unsupported image type" }, 415, cors);
  const bytes = await downloaded.arrayBuffer();
  const size = bytes.byteLength;
  if (size < 1 || size > MAX_FILE_SIZE) return json({ error: "file must be between 1 byte and 30 MB" }, 413, cors);
  const trip = safeSegment(input.trip, "unassigned");
  const chapter = safeSegment(input.chapter, "chapter");
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" })[type];
  const key = `${trip}/${chapter}/${crypto.randomUUID()}.${extension}`;
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  return json({ key, url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}`, name: String(input.name || "photo").slice(0, 200), type, size, google_media_item_id: String(input.google_media_item_id || "") }, 201, cors);
}

function validateTripRequest(input) {
  if (input?.schema_version !== 1 || input?.type !== "new_trip_request") throw new Response("Unknown trip request format", { status: 400 });
  const trip = safeSegment(input.trip?.id, "");
  if (!trip || trip !== input.trip?.id || !String(input.trip?.title || "").trim()) throw new Response("Invalid trip", { status: 400 });
  if (!Array.isArray(input.chapters) || !input.chapters.length) throw new Response("At least one chapter is required", { status: 400 });
  for (const chapter of input.chapters) {
    const chapterId = safeSegment(chapter.id, "");
    if (!chapterId || chapterId !== chapter.id || !String(chapter.title || "").trim()) throw new Response("Invalid chapter", { status: 400 });
    for (const photo of chapter.photos || []) {
      let url;
      try { url = new URL(String(photo.url || "").match(/^\[[^\]]+]\(([^)]+)\)$/)?.[1] || photo.url); } catch { throw new Response("Invalid photo URL", { status: 400 }); }
      if (url.protocol !== "https:" || url.hostname !== "photos.owntravel.ru" || !String(photo.key || "").startsWith(`${trip}/${chapterId}/`)) throw new Response("Photo is outside this chapter R2 path", { status: 400 });
    }
  }
  return trip;
}

async function submitTrip(request, env, cors) {
  await authorize(request, env);
  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPOSITORY) return json({ error: "Editorial automation is not configured" }, 503, cors);
  const length = Number(request.headers.get("Content-Length")) || 0;
  if (length > MAX_REQUEST_SIZE) return json({ error: "Trip request is too large" }, 413, cors);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_SIZE) return json({ error: "Trip request is too large" }, 413, cors);
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: "Trip request is not valid JSON" }, 400, cors); }
  const trip = validateTripRequest(input);
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "travel-journal-uploader", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ event_type: "author_trip_submitted", client_payload: { request: input } })
  });
  if (!response.ok) { console.error("GitHub dispatch failed", response.status, await response.text()); return json({ error: "Editorial automation did not accept the request" }, 502, cors); }
  const chapters = input.chapters.map(chapter => ({ id: chapter.id, editor_url: `https://owntravel.ru/editor.html?trip=${trip}&chapter=${chapter.id}` }));
  return json({ accepted: true, trip, status_url: `https://owntravel.ru/submission.html?trip=${trip}`, chapters }, 202, cors);
}

async function dispatchEditorial(request, env, cors, eventType) {
  await authorize(request, env);
  if (!env.GITHUB_DISPATCH_TOKEN || !env.GITHUB_REPOSITORY) return json({ error: "Editorial automation is not configured" }, 503, cors);
  const input = await request.json();
  const trip = safeSegment(input.trip, ""); const chapter = safeSegment(input.chapter, "");
  if (!trip || trip !== input.trip || !chapter || chapter !== input.chapter) return json({ error: "Invalid editorial target" }, 400, cors);
  if (eventType === "photo_selection_approved") {
    if (input.schema_version !== 2 || input.approval !== "photo_selection_approved" || !Array.isArray(input.items) || input.items.filter(item => item.status === "hero").length !== 1 || input.items.some(item => !["hero", "story", "backstage", "skip"].includes(item.status))) return json({ error: "Invalid author review" }, 400, cors);
  }
  if (eventType === "preview_approved" && (input.status !== "preview_approved" || !input.photos_fingerprint)) return json({ error: "Invalid preview approval" }, 400, cors);
  const response = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/dispatches`, { method: "POST", headers: { Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "travel-journal-uploader", "X-GitHub-Api-Version": "2022-11-28" }, body: JSON.stringify({ event_type: eventType, client_payload: { artifact: input } }) });
  if (!response.ok) return json({ error: "Editorial automation did not accept the approval" }, 502, cors);
  return json({ accepted: true, status_url: `https://owntravel.ru/submission.html?trip=${trip}`, preview_url: `https://owntravel.ru/preview.html?trip=${trip}&chapter=${chapter}` }, 202, cors);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, storage: "r2" }, 200, cors);
    if (request.method === "GET" && url.pathname.startsWith("/media/")) {
      const key = decodeURIComponent(url.pathname.slice(7));
      if (!key || key.includes("..")) return new Response("Invalid media key", { status: 400 });
      const object = await env.PHOTOS.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("ETag", object.httpEtag); headers.set("Cache-Control", "public, max-age=31536000, immutable"); headers.set("Access-Control-Allow-Origin", "*");
      return new Response(object.body, { headers });
    }
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: "origin is not allowed" }, 403, cors);
    try {
      if (request.method === "GET" && url.pathname === "/whoami") {
        const info = await verifyGoogleToken(request, env);
        const email = String(info.email || "");
        if (!email || info.email_verified === "false") return json({ error: "Google did not return a verified email; request userinfo.email scope again" }, 422, cors);
        return json({ google_email: email }, 200, cors);
      }
      if (request.method === "POST" && url.pathname === "/upload") return await upload(request, env, cors);
      if (request.method === "POST" && url.pathname === "/import") return await importGooglePhoto(request, env, cors);
      if (request.method === "POST" && url.pathname === "/submit") return await submitTrip(request, env, cors);
      if (request.method === "POST" && url.pathname === "/approve-photos") return await dispatchEditorial(request, env, cors, "photo_selection_approved");
      if (request.method === "POST" && url.pathname === "/approve-preview") return await dispatchEditorial(request, env, cors, "preview_approved");
      return json({ error: "not found" }, 404, cors);
    } catch (error) {
      if (error instanceof Response) return new Response(error.body, { status: error.status, headers: cors });
      console.error(error);
      return json({ error: "internal error" }, 500, cors);
    }
  }
};
