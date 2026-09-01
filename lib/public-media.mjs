import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SOURCE = "https://api.owntravel.ru";
const DEFAULT_WIDTH = 1600;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

export function normalizedPhotoKey(photo) {
  const value = String(photo?.key || "").trim().replace(/^\/+/, "");
  const segments = value.split("/");
  if (!value || segments.some(segment => !segment || segment === "." || segment === "..")) return "";
  return segments.join("/");
}

export function encodedPhotoKey(photo) {
  const key = normalizedPhotoKey(photo);
  return key ? key.split("/").map(encodeURIComponent).join("/") : "";
}

export function publicPhotoUrl(photo) {
  const key = encodedPhotoKey(photo);
  return key ? `/media/${key}` : photo?.url || "";
}

async function existingFile(file) {
  try {
    return (await fs.stat(file)).size > 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function downloadPhoto({ photo, root, source, width }) {
  const key = normalizedPhotoKey(photo);
  if (!key) throw new Error("Published photo has no safe object key");
  const mediaRoot = path.resolve(root, "media");
  const destination = path.resolve(mediaRoot, key);
  if (!destination.startsWith(`${mediaRoot}${path.sep}`)) throw new Error(`Unsafe published photo key: ${key}`);
  if (await existingFile(destination)) return { key, status: "existing" };

  const encoded = key.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`/thumbnail/${encoded}`, source);
  url.searchParams.set("w", String(width));
  const response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!response.ok) throw new Error(`Could not fetch ${key}: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("image/")) throw new Error(`Could not fetch ${key}: ${contentType || "non-image response"}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error(`Unexpected image size for ${key}: ${bytes.length}`);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  await fs.writeFile(temporary, bytes);
  await fs.rename(temporary, destination);
  return { key, status: "downloaded", bytes: bytes.length };
}

export async function materializePublicPhotos({ root = ".", photos = [], source = process.env.PUBLIC_MEDIA_SOURCE || DEFAULT_SOURCE, width = DEFAULT_WIDTH, concurrency = 6 } = {}) {
  const unique = new Map();
  for (const photo of photos) {
    const key = normalizedPhotoKey(photo);
    if (key) unique.set(key, photo);
  }
  const queue = [...unique.values()];
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), queue.length || 1) }, async () => {
    while (cursor < queue.length) {
      const photo = queue[cursor++];
      results.push(await downloadPhoto({ photo, root, source, width }));
    }
  });
  await Promise.all(workers);
  return results;
}
