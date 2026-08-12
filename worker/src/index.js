const MAX_FILE_SIZE = 30 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

function corsHeaders(origin, allowedOrigin) {
  return {
    "Access-Control-Allow-Origin": origin === allowedOrigin ? origin : allowedOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}

function safeSegment(value, fallback) {
  const result = String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return result || fallback;
}

async function authorize(request, env) {
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

async function importPhotos(request, env, cors) {
  const tokenInfo = await authorize(request, env);
  const { trip, chapter, mediaItems } = await request.json();
  if (!Array.isArray(mediaItems) || !mediaItems.length || mediaItems.length > 100) return json({ error: "mediaItems must contain 1–100 items" }, 400, cors);
  const prefix = `${safeSegment(trip, "unassigned")}/${safeSegment(chapter, "chapter")}`;
  const photos = [];
  for (const item of mediaItems) {
    let source;
    try { source = new URL(item.baseUrl); } catch { return json({ error: "invalid media item URL" }, 400, cors); }
    if (source.protocol !== "https:" || source.hostname !== "lh3.googleusercontent.com") return json({ error: "invalid media item host" }, 400, cors);
    const response = await fetch(`${source.href}=d`, { headers: { Authorization: request.headers.get("Authorization") } });
    if (!response.ok) return json({ error: `Google media download failed: ${response.status}` }, 502, cors);
    const size = Number(response.headers.get("Content-Length") || 0);
    const type = response.headers.get("Content-Type")?.split(";")[0] || item.mimeType;
    if (!ALLOWED_TYPES.has(type) || size > MAX_FILE_SIZE) return json({ error: "unsupported or oversized Google photo" }, 415, cors);
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" })[type];
    const key = `${prefix}/${crypto.randomUUID()}.${extension}`;
    await env.PHOTOS.put(key, response.body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { originalName: String(item.filename || item.id || "photo").slice(0, 200), googleUser: tokenInfo.sub || "" } });
    photos.push({ name: item.filename || "Google Photo", type, size, key, url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/${key}` });
  }
  return json({ photos }, 201, cors);
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
      if (request.method === "POST" && url.pathname === "/import") return await importPhotos(request, env, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (error) {
      if (error instanceof Response) return new Response(error.body, { status: error.status, headers: cors });
      console.error(error);
      return json({ error: "internal error" }, 500, cors);
    }
  }
};
