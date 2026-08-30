import fs from "fs/promises";
import { inventoryItems, resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";

const target = resolveEditorialTarget();
const trip = target.trip;
const dayTag = target.chapter;
const storyboardFile = process.env.STORYBOARD_FILE || `data/${trip}/${dayTag}-storyboard.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const contextFile = process.env.CHAPTER_CONTEXT_FILE || process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const photosFile = process.env.PHOTOS_FILE || `data/${trip}/${dayTag}-photos.json`;
const reviewFile = process.env.REVIEW_FILE || `data/${trip}/${dayTag}-author-review.json`;

async function readJson(path) { return JSON.parse(await fs.readFile(path, "utf8")); }
async function readJsonIfExists(path) { try { return await readJson(path); } catch (error) { return null; } }
function normalizeText(value) { return String(value || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s-]/g, " ").replace(/\s+/g, " ").trim(); }
function routePlaces(authorNotes, chapterContext) {
  const order = authorNotes?.actual_route_order || [];
  if (Array.isArray(order) && order.length) return order.map(String);
  if (Array.isArray(chapterContext?.route) && chapterContext.route.length) return chapterContext.route.map(String);
  if (Array.isArray(chapterContext?.route_context) && chapterContext.route_context.length) return chapterContext.route_context.map(String);
  const route = authorNotes?.route || chapterContext?.route || "";
  return String(route).split("→").map(item => item.trim()).filter(Boolean);
}

function fallbackHeading(scene) {
  const source = String(scene?.text || "").trim().replace(/[.!?]+$/g, "");
  if (!source) return "";
  const compact = source.replace(/\s+/g, " ");
  const words = compact.split(" ").slice(0, 7).join(" ");
  return words.length <= 72 ? words : `${words.slice(0, 69).trimEnd()}…`;
}

// Geography must never be inferred from a caption, title, editorial note, filename,
// public ID or photo order. Route validation may use only an explicit scene.place.
function detectExplicitPlaceIndex(scene, places) {
  const explicitPlace = normalizeText(scene?.place);
  if (!explicitPlace) return -1;
  for (let i = 0; i < places.length; i += 1) {
    const routePlace = normalizeText(places[i]);
    if (!routePlace) continue;
    if (explicitPlace === routePlace || explicitPlace.includes(routePlace) || routePlace.includes(explicitPlace)) return i;
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
const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
const seen = new Set();
let normalizedHeadings = 0;

if (approvedStoryIds.size && scenes.length !== approvedStoryIds.size) errors.push(`Storyboard must have one scene per approved photo: expected ${approvedStoryIds.size}, got ${scenes.length}`);

for (const scene of scenes) {
  if (!Array.isArray(scene.photos) || scene.photos.length !== 1) {
    errors.push(`Scene must contain exactly one photo: ${scene.id || scene.title || "untitled"}`);
    continue;
  }
  if (!String(scene.title || "").trim()) {
    const heading = fallbackHeading(scene);
    if (heading) {
      scene.title = heading;
      normalizedHeadings += 1;
    } else {
      errors.push(`Scene photo has no individual heading: ${scene.id || scene.photos[0]}`);
    }
  }
  if (!String(scene.text || "").trim()) errors.push(`Scene photo has no individual caption: ${scene.id || scene.title || scene.photos[0]}`);
  const id = scene.photos[0];
  if (inventoryIds.size && !inventoryIds.has(id)) errors.push(`Unknown public_id in storyboard: ${id}`);
  if (approvedStoryIds.size && !approvedStoryIds.has(id)) errors.push(`Storyboard contains a photo not approved for story: ${id}`);
  if (seen.has(id)) errors.push(`Storyboard duplicates public_id: ${id}`);
  seen.add(id);
}

if (approvedStoryIds.size) for (const id of approvedStoryIds) if (!seen.has(id)) errors.push(`Storyboard omitted approved story photo: ${id}`);

const places = routePlaces(authorNotes, chapterContext);
if (places.length) {
  let lastPlaceIndex = -1;
  for (const scene of scenes) {
    const placeIndex = detectExplicitPlaceIndex(scene, places);
    if (placeIndex < 0) { warnings.push(`Scene has no confirmed route place: ${scene.id || scene.title || "untitled"}`); continue; }
    if (placeIndex < lastPlaceIndex) errors.push(`Route order is broken at scene: ${scene.id || scene.title}. Explicit place ${places[placeIndex]} appears after ${places[lastPlaceIndex]}.`);
    lastPlaceIndex = Math.max(lastPlaceIndex, placeIndex);
  }
}

if (warnings.length) console.warn(warnings.map(item => `WARN: ${item}`).join("\n"));
if (errors.length) { console.error(errors.map(item => `ERROR: ${item}`).join("\n")); process.exit(1); }
if (normalizedHeadings) {
  await fs.writeFile(storyboardFile, `${JSON.stringify(storyboard, null, 2)}\n`, "utf8");
  console.log(`Normalized ${normalizedHeadings} empty storyboard heading(s) from grounded scene captions`);
}
console.log(`Storyboard validation passed for ${trip} ${dayTag}: ${scenes.length} photos, ${scenes.length} individual headings and captions`);
