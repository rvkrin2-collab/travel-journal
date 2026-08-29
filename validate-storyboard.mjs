import fs from "fs/promises";
import { inventoryItems, resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";

const target = resolveEditorialTarget(); const trip = target.trip; const dayTag = target.chapter;
const storyboardFile = process.env.STORYBOARD_FILE || `data/${trip}/${dayTag}-storyboard.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const contextFile = process.env.CHAPTER_CONTEXT_FILE || process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const photosFile = process.env.PHOTOS_FILE || `data/${trip}/${dayTag}-photos.json`;
const reviewFile = process.env.REVIEW_FILE || `data/${trip}/${dayTag}-author-review.json`;

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

function routePlaces(authorNotes, chapterContext) {
  const order = authorNotes?.actual_route_order || [];
  if (Array.isArray(order) && order.length) return order.map(String);
  if (Array.isArray(chapterContext?.route) && chapterContext.route.length) return chapterContext.route.map(String);
  if (Array.isArray(chapterContext?.route_context) && chapterContext.route_context.length) return chapterContext.route_context.map(String);
  const route = authorNotes?.route || chapterContext?.route || "";
  return String(route)
    .split("→")
    .map(item => item.trim())
    .filter(Boolean);
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
const chapterContext = await readJsonIfExists(contextFile);
const inventory = await readJsonIfExists(photosFile);
const photos = inventory ? inventoryItems(inventory) : null;
const review = await readJsonIfExists(reviewFile);
const errors = [];
const warnings = [];

const inventoryIds = new Set((photos || []).map(photo => photo.public_id));
const approvedItems = review?.items || [];
const approvedStoryIds = new Set(approvedItems.filter(item => item.status === "hero" || item.status === "story").map(item => item.public_id));
const seen = new Set();

for (const scene of storyboard.scenes || []) {
  if (!Array.isArray(scene.photos) || !scene.photos.length) errors.push(`Scene has no photos: ${scene.id || scene.title || "untitled"}`);
  for (const id of scene.photos || []) {
    if (inventoryIds.size && !inventoryIds.has(id)) errors.push(`Unknown public_id in storyboard: ${id}`);
    if (approvedStoryIds.size && !approvedStoryIds.has(id)) errors.push(`Storyboard contains a photo not approved for story: ${id}`);
    if (seen.has(id)) errors.push(`Storyboard duplicates public_id: ${id}`);
    seen.add(id);
  }
}

if (approvedStoryIds.size) {
  for (const id of approvedStoryIds) if (!seen.has(id)) errors.push(`Storyboard omitted approved story photo: ${id}`);
}

const places = routePlaces(authorNotes, chapterContext);
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
