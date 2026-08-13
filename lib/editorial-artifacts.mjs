import { createHash } from "node:crypto";
import path from "node:path";

const SAFE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function safeSlug(value, label = "slug") {
  const slug = String(value || "").trim().toLowerCase();
  if (!SAFE_SLUG.test(slug)) throw new Error(`${label} must contain lowercase letters, numbers, and hyphens`);
  return slug;
}

export function resolveChapter(value, fallback = "day01") {
  const raw = String(value || fallback).trim().toLowerCase();
  const legacy = raw.match(/^day[-_ ]?(\d+)$/);
  return safeSlug(legacy ? `day${String(Number(legacy[1])).padStart(2, "0")}` : raw, "chapter");
}

export function resolveEditorialTarget(env = process.env) {
  const trip = safeSlug(env.TRIP || "kyrgyzstan-2026", "trip");
  const chapter = resolveChapter(env.CHAPTER || env.CHAPTER_ID || env.DAY_TAG || "day01");
  const base = path.posix.join("data", trip);
  const artifact = suffix => path.posix.join(base, `${chapter}-${suffix}.json`);
  return { trip, chapter, photos: artifact("photos"), analysis: artifact("analysis"), aiReview: artifact("ai-review"), authorReview: artifact("author-review"), finalReview: artifact("final-review"), storyboard: artifact("storyboard"), approval: artifact("approval") };
}

export function photoId(photo) {
  return String(photo?.photo_id || photo?.public_id || photo?.key || photo?.google_media_item_id || "").trim();
}

export function normalizePhoto(photo, source = "r2") {
  const id = photoId(photo);
  if (!id) throw new Error("Photo is missing a stable identifier");
  const url = String(photo.url || photo.secure_url || "").trim();
  if (!url.startsWith("https://")) throw new Error(`Photo ${id} is missing an HTTPS URL`);
  return { photo_id: id, public_id: id, source: String(photo.source || source), url, width: Number(photo.width) || 0, height: Number(photo.height) || 0, name: String(photo.name || ""), type: String(photo.type || "image/jpeg"), size: Number(photo.size) || 0, key: String(photo.key || "") };
}

export function fingerprintPhotos(photos) {
  const canonical = photos.map(photo => normalizePhoto(photo, photo.source || "legacy")).map(photo => [photo.photo_id, photo.url, photo.width, photo.height, photo.size]).sort((a, b) => a[0].localeCompare(b[0]));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function createPhotoInventory({ trip, chapter, photos, source = "google_photos_r2" }) {
  trip = safeSlug(trip, "trip"); chapter = resolveChapter(chapter);
  const items = photos.map(photo => normalizePhoto(photo, source));
  const ids = items.map(photo => photo.photo_id);
  if (new Set(ids).size !== ids.length) throw new Error(`${chapter}: duplicate photo identifiers`);
  return { schema_version: 2, trip, chapter, source, generated_at: new Date().toISOString(), photo_count: items.length, photos_fingerprint: fingerprintPhotos(items), items };
}

export function inventoryItems(value) {
  return Array.isArray(value) ? value.map(photo => normalizePhoto(photo, "legacy")) : (value?.items || []).map(photo => normalizePhoto(photo, value.source || "legacy"));
}

export function inventoryFingerprint(value) {
  const items = inventoryItems(value);
  return value?.photos_fingerprint || fingerprintPhotos(items);
}

export function assertSamePhotoSet(inventory, artifact, label) {
  const photos = inventoryItems(inventory);
  const expected = new Set(photos.map(photoId));
  const actualItems = artifact?.items;
  if (!Array.isArray(actualItems)) throw new Error(`${label} has no items`);
  const actual = actualItems.map(photoId);
  if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some(id => !expected.has(id))) throw new Error(`${label} does not cover the exact photo inventory`);
  const fingerprint = inventoryFingerprint(inventory);
  if (artifact.photos_fingerprint && artifact.photos_fingerprint !== fingerprint) throw new Error(`${label} uses a stale photos fingerprint`);
  return fingerprint;
}
