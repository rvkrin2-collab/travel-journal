import fs from "node:fs/promises";
import { assertSamePhotoSet, inventoryItems, photoId, resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";
import { readerCaptionSeed } from "./lib/reader-caption.mjs";

const target = resolveEditorialTarget();
const photosFile = process.env.PHOTOS_FILE || target.photos;
const analysisFile = process.env.ANALYSIS_FILE || target.analysis;
const outFile = process.env.OUT_FILE || target.aiReview;
const read = async file => JSON.parse(await fs.readFile(file, "utf8"));

function sanitizeObservationLabel(value) {
  let text = String(value || "").trim();
  const replacements = [
    [/ярко-голубой панцирный морской член/giu, "ярко-голубое морское членистоногое"],
    [/панцирный морской член/giu, "морское членистоногое"],
    [/люминесцирующ\p{L}*/giu, "ярко выделяющееся"],
    [/кладбище заброшенных лодок и хозяйственных построек/giu, "старые лодки и хозяйственные постройки"],
    [/рыболовное судно/giu, "судно"],
    [/ресторан/giu, "здание"],
    [/гранитными глыбами/giu, "каменными глыбами"],
    [/травянистой тундрой/giu, "низкой травянистой растительностью"],
    [/тундровой растительностью/giu, "низкорослой растительностью"],
    [/тундровый ландшафт/giu, "ландшафт с низкорослой растительностью"],
    [/тундровый пейзаж/giu, "пейзаж с низкорослой растительностью"],
    [/с озёрами,/giu, "с небольшими водоёмами,"],
    [/пейзаж с низкорослой растительностью с небольшими водоёмами/giu, "пейзаж с низкорослой растительностью и небольшими водоёмами"]
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  text = text.replace(/\s{2,}/g, " ").trim();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

const inventory = await read(photosFile);
const photos = inventoryItems(inventory);
const analysis = await read(analysisFile);
const fingerprint = assertSamePhotoSet(inventory, analysis, "analysis");
const decisions = analysis.recommendation?.decisions;
if (!decisions) throw new Error("analysis recommendation is missing; run complete series selection first");
const analysisById = new Map(analysis.items.map(item => [photoId(item), item]));

const items = photos.map((photo, index) => {
  const id = photoId(photo);
  const observed = analysisById.get(id);
  const decision = decisions[id];
  if (!observed) throw new Error(`Missing visual analysis for ${id}`);
  if (!decision || !["hero", "story", "backstage", "skip"].includes(decision.status)) throw new Error(`Missing AI decision for ${id}`);
  const label = sanitizeObservationLabel(observed.observation_label);
  if (!label) throw new Error(`Missing observation_label for ${id}; rerun visual analysis`);
  return {
    public_id: id,
    photo_id: id,
    number: index + 1,
    status: decision.status,
    label,
    note: readerCaptionSeed(observed, label),
    observation_only: true
  };
});
if (items.filter(item => item.status === "hero").length !== 1) throw new Error("AI review must suggest exactly one hero");

const review = {
  schema_version: 3,
  trip: target.trip,
  chapter: {
    title: "",
    subtitle: "",
    route_note: "",
    fact_checks: []
  },
  day: target.chapter,
  photos_source: photosFile,
  analysis_source: analysisFile,
  photos_fingerprint: fingerprint,
  status: "ai_review",
  approval: "not_author_approved",
  updated_at: new Date().toISOString(),
  fact_checks_deferred_to_text_stage: true,
  items
};

await fs.writeFile(outFile, `${JSON.stringify(review, null, 2)}\n`, "utf8");
console.log(`Saved observation-safe AI review for ${items.length} photos; fact checks deferred to text stage`);
