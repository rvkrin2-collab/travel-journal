import fs from "fs/promises";

const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const storyboardFile = process.env.STORYBOARD_FILE || `data/${trip}/${dayTag}-storyboard.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const photosFile = process.env.PHOTOS_FILE || `data/${trip}/${dayTag}-photos.json`;
const reviewFile = process.env.REVIEW_FILE || `data/${trip}/${dayTag}-author-review.json`;

function normalizeDay(value) {
  const raw = String(value || "").trim().toLowerCase();
  const number = raw.match(/\d+/);
  if (number) return `day${String(Number(number[0])).padStart(2, "0")}`;
  return raw.replace(/[^a-z0-9-]/g, "") || "day01";
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try { return await readJson(path); } catch (error) { return null; }
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sceneText(scene) {
  return normalizeText([scene.place, scene.title, scene.text, scene.editorial_note].filter(Boolean).join(" "));
}

function routePlaces(authorNotes) {
  const order = authorNotes?.actual_route_order || [];
  if (Array.isArray(order) && order.length) return order.map(String);
  return String(authorNotes?.route || "")
    .split("→")
    .map(item => item.trim())
    .filter(Boolean);
}

function knownPhotoIds(photos, review) {
  return new Set([
    ...(Array.isArray(photos) ? photos.map(photo => photo.public_id) : []),
    ...((review?.items || []).map(item => item.public_id))
  ]);
}

function detectPlaceIndex(scene, places) {
  const text = sceneText(scene);
  for (let i = 0; i < places.length; i += 1) {
    const place = normalizeText(places[i]);
    if (!place) continue;
    const tokens = place.split(" ").filter(token => token.length > 3);
    if (text.includes(place) || tokens.some(token => text.includes(token))) return i;
  }
  return -1;
}

const storyboard = await readJson(storyboardFile);
const authorNotes = await readJsonIfExists(authorNotesFile);
const photos = await readJsonIfExists(photosFile);
const review = await readJsonIfExists(reviewFile);
const errors = [];
const warnings = [];

const ids = knownPhotoIds(photos, review);
for (const scene of storyboard.scenes || []) {
  for (const id of scene.photos || []) {
    if (!ids.has(id)) errors.push(`Unknown public_id in storyboard: ${id}`);
  }
}

const places = routePlaces(authorNotes);
if (places.length) {
  let lastPlaceIndex = -1;
  for (const scene of storyboard.scenes || []) {
    const placeIndex = detectPlaceIndex(scene, places);
    if (placeIndex < 0) {
      warnings.push(`Scene has unclear route place: ${scene.id || scene.title || "untitled"}`);
      continue;
    }
    if (placeIndex < lastPlaceIndex) {
      errors.push(`Route order is broken at scene: ${scene.id || scene.title}. Detected ${places[placeIndex]} after ${places[lastPlaceIndex]}.`);
    }
    lastPlaceIndex = Math.max(lastPlaceIndex, placeIndex);
  }
}

if (warnings.length) console.warn(warnings.map(item => `WARN: ${item}`).join("\n"));
if (errors.length) {
  console.error(errors.map(item => `ERROR: ${item}`).join("\n"));
  process.exit(1);
}
console.log(`Storyboard validation passed for ${trip} ${dayTag}`);
