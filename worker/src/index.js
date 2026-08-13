const MAX_FILE_SIZE = 30 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

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

export async function authorize(request, env) {
  const token = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new Response("Missing bearer token", { status: 401 });
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Response("Invalid Google token", { status: 401 });
  const info = await response.json();
  if (info.aud !== env.GOOGLE_CLIENT_ID) throw new Response("Wrong token audience", { status: 403 });
  const scopes = new Set(String(info.scope || "").split(/\s+/));
  if (!scopes.has("https://www.googleapis.com/auth/photospicker.mediaitems.readonly")) throw new Response("Missing Picker scope", { status: 403 });
  const allowedUsers = new Set(String(env.ALLOWED_GOOGLE_USER_IDS || "").split(",").map(value => value.trim()).filter(Boolean));
  const userId = String(info.sub || info.user_id || "");
  if (!allowedUsers.size) throw new Response("Uploader allowlist is not configured", { status: 503 });
  if (!userId || !allowedUsers.has(userId)) throw new Response("Google account is not allowed", { status: 403 });
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return json({ ok: true, storage: "r2" }, 200, cors);
    if (origin !== env.ALLOWED_ORIGIN) return json({ error: "origin is not allowed" }, 403, cors);
    try {
      if (request.method === "POST" && url.pathname === "/upload") return await upload(request, env, cors);
      if (request.method === "POST" && url.pathname === "/import") return await importGooglePhoto(request, env, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (error) {
      if (error instanceof Response) return new Response(error.body, { status: error.status, headers: cors });
      console.error(error);
      return json({ error: "internal error" }, 500, cors);
    }
  }
};
