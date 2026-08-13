import fs from "node:fs/promises";
import { assertSamePhotoSet, inventoryFingerprint, inventoryItems, photoId, resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";

const target = resolveEditorialTarget();
const photosFile = process.env.PHOTOS_FILE || target.photos;
const analysisFile = process.env.ANALYSIS_FILE || target.analysis;
const outFile = process.env.OUT_FILE || target.aiReview;
const read = async file => JSON.parse(await fs.readFile(file, "utf8"));

const inventory = await read(photosFile);
const photos = inventoryItems(inventory);
const analysis = await read(analysisFile);
const fingerprint = assertSamePhotoSet(inventory, analysis, "analysis");
const decisions = analysis.recommendation?.decisions;
if (!decisions) throw new Error("analysis recommendation is missing; run complete series selection first");
const analysisById = new Map(analysis.items.map(item => [photoId(item), item]));

const items = photos.map((photo, index) => {
  const id = photoId(photo); const observed = analysisById.get(id); const decision = decisions[id];
  if (!decision || !["hero", "story", "backstage", "skip"].includes(decision.status)) throw new Error(`Missing AI decision for ${id}`);
  return { public_id: id, photo_id: id, number: index + 1, status: decision.status, label: String(observed.visual_summary || observed.caption_seed || "").trim(), note: String(decision.reason || observed.editor_note || "").trim(), observation_only: true };
});
if (items.filter(item => item.status === "hero").length !== 1) throw new Error("AI review must suggest exactly one hero");

const review = {
  schema_version: 2, trip: target.trip, chapter: target.chapter, day: target.chapter,
  photos_source: photosFile, analysis_source: analysisFile, photos_fingerprint: fingerprint,
  status: "ai_review", approval: "not_author_approved", updated_at: new Date().toISOString(),
  chapter: { title: "", subtitle: "", route_note: "", fact_checks: analysis.recommendation.fact_checks || [] },
  items
};
await fs.writeFile(outFile, `${JSON.stringify(review, null, 2)}\n`, "utf8");
console.log(`Saved photo-only AI review for ${items.length} photos; no chapter copy was generated`);
