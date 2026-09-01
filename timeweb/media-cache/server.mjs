import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_ROOT = process.env.CACHE_ROOT || "/cache";
const ORIGIN = String(process.env.MEDIA_ORIGIN || "https://upload.owntravel.ru").replace(/\/$/, "");
const PORT = Number(process.env.PORT || 8080);
const MAX_OBJECT_SIZE = 35 * 1024 * 1024;
const inflight = new Map();

function cacheId(url) {
  return createHash("sha256").update(`${url.pathname}${url.search}`).digest("hex");
}

function pathsFor(url) {
  const id = cacheId(url);
  const directory = join(CACHE_ROOT, id.slice(0, 2));
  return {
    body: join(directory, `${id}.body`),
    metadata: join(directory, `${id}.json`),
    directory
  };
}

function validMediaPath(pathname) {
  if (!/^\/(media|thumbnail)\/[a-z0-9/_\-.]+$/i.test(pathname)) return false;
  try {
    return !decodeURIComponent(pathname).includes("..");
  } catch {
    return false;
  }
}

async function readCached(url) {
  const paths = pathsFor(url);
  try {
    const [metadata, body] = await Promise.all([
      readFile(paths.metadata, "utf8").then(JSON.parse),
      readFile(paths.body)
    ]);
    return { metadata, body };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function fetchAndCache(url) {
  const id = cacheId(url);
  if (inflight.has(id)) return inflight.get(id);

  const task = (async () => {
    const upstreamUrl = new URL(`${url.pathname}${url.search}`, ORIGIN);
    const response = await fetch(upstreamUrl, {
      headers: { "User-Agent": "owntravel-timeweb-media-cache/1.0" },
      signal: AbortSignal.timeout(45_000)
    });
    if (!response.ok) {
      return {
        status: response.status,
        metadata: { contentType: response.headers.get("content-type") || "text/plain; charset=utf-8" },
        body: Buffer.from(await response.arrayBuffer())
      };
    }

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_OBJECT_SIZE) throw new Error("origin object is too large");
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > MAX_OBJECT_SIZE) throw new Error("origin object is too large");

    const metadata = {
      contentType: response.headers.get("content-type") || "application/octet-stream",
      etag: response.headers.get("etag") || `"${createHash("sha256").update(body).digest("hex")}"`,
      cachedAt: new Date().toISOString()
    };
    const paths = pathsFor(url);
    await mkdir(paths.directory, { recursive: true });
    const temporaryBody = `${paths.body}.${process.pid}.tmp`;
    const temporaryMetadata = `${paths.metadata}.${process.pid}.tmp`;
    try {
      await Promise.all([
        writeFile(temporaryBody, body, { flag: "wx" }),
        writeFile(temporaryMetadata, `${JSON.stringify(metadata)}\n`, { flag: "wx" })
      ]);
      await Promise.all([rename(temporaryBody, paths.body), rename(temporaryMetadata, paths.metadata)]);
    } finally {
      await Promise.all([rm(temporaryBody, { force: true }), rm(temporaryMetadata, { force: true })]);
    }
    return { status: 200, metadata, body };
  })().finally(() => inflight.delete(id));

  inflight.set(id, task);
  return task;
}

function send(res, result, method, cacheState) {
  res.writeHead(result.status || 200, {
    "Content-Type": result.metadata.contentType,
    ...(result.metadata.etag ? { ETag: result.metadata.etag } : {}),
    "Content-Length": result.body.length,
    "Cache-Control": result.status === 200 ? "public, max-age=31536000, immutable" : "no-store",
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    "X-OwnTravel-Cache": cacheState
  });
  res.end(method === "HEAD" ? undefined : result.body);
}

export async function handleRequest(req, res) {
  const url = new URL(req.url, "http://media-cache.local");
  if (url.pathname === "/health") {
    const body = Buffer.from(JSON.stringify({ ok: true, service: "owntravel-media-cache" }));
    return send(res, { status: 200, metadata: { contentType: "application/json; charset=utf-8" }, body }, req.method, "BYPASS");
  }
  if (!(["GET", "HEAD"].includes(req.method)) || !validMediaPath(url.pathname)) {
    const body = Buffer.from("Not found");
    return send(res, { status: 404, metadata: { contentType: "text/plain; charset=utf-8" }, body }, req.method, "BYPASS");
  }

  try {
    const cached = await readCached(url);
    if (cached) return send(res, { status: 200, ...cached }, req.method, "HIT");
    return send(res, await fetchAndCache(url), req.method, "MISS");
  } catch (error) {
    console.error("media cache request failed", url.pathname, error);
    const body = Buffer.from("Media temporarily unavailable");
    return send(res, { status: 502, metadata: { contentType: "text/plain; charset=utf-8" }, body }, req.method, "ERROR");
  }
}

export function startServer(port = PORT) {
  return createServer((req, res) => void handleRequest(req, res)).listen(port, "0.0.0.0", () => {
    console.log(`OwnTravel media cache listening on ${port}; origin ${ORIGIN}`);
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) startServer();
