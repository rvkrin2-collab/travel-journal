import fs from "fs/promises";

const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const photosFile = process.env.PHOTOS_FILE || `data/${trip}/${dayTag}-photos.json`;
const authorReviewFile = process.env.AUTHOR_REVIEW_FILE || `data/${trip}/${dayTag}-author-review.json`;
const finalReviewFile = process.env.FINAL_REVIEW_FILE || `data/${trip}/${dayTag}-final-review.json`;

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

function sameText(a, b) {
  return String(a || "").trim() === String(b || "").trim();
}

const photos = await readJson(photosFile);
const authorReview = await readJson(authorReviewFile);
const finalReview = await readJsonIfExists(finalReviewFile);
const errors = [];

const knownPhotoIds = new Set(photos.map(photo => photo.public_id));
const authorItems = new Map((authorReview.items || []).map(item => [item.public_id, item]));

for (const item of authorReview.items || []) {
  if (!knownPhotoIds.has(item.public_id)) errors.push(`author-review uses unknown public_id: ${item.public_id}`);
}

if (finalReview) {
  for (const item of finalReview.items || []) {
    if (!knownPhotoIds.has(item.public_id)) errors.push(`final-review uses unknown public_id: ${item.public_id}`);
    const authorItem = authorItems.get(item.public_id);
    if (!authorItem) errors.push(`final-review contains public_id absent from author-review: ${item.public_id}`);
    if (authorItem && authorItem.status !== item.status) {
      errors.push(`final-review changed author status for ${item.public_id}: ${authorItem.status} -> ${item.status}`);
    }
  }
  const authorRoute = authorReview.chapter?.route_note;
  const finalRoute = finalReview.chapter?.route_note;
  if (authorRoute && finalRoute && !sameText(authorRoute, finalRoute)) {
    errors.push(`final-review route_note differs from author-review: "${authorRoute}" vs "${finalRoute}"`);
  }
  const heroCount = (finalReview.items || []).filter(item => item.status === "hero").length;
  if (heroCount !== 1) errors.push(`final-review must contain exactly one hero, got ${heroCount}`);
}

const authorHeroCount = (authorReview.items || []).filter(item => item.status === "hero").length;
if (authorHeroCount !== 1) errors.push(`author-review must contain exactly one hero, got ${authorHeroCount}`);

if (errors.length) {
  console.error(errors.map(error => `ERROR: ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Review consistency validation passed for ${trip} ${dayTag}`);
