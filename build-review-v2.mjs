import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const photosFile = process.env.PHOTOS_FILE || `data/${trip}/${dayTag}-photos.json`;
const analysisFile = process.env.ANALYSIS_FILE || `data/${trip}/${dayTag}-analysis.json`;
const contextFile = process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-ai-review.json`;

if (!apiKey) throw new Error("OPENAI_API_KEY secret is missing");

function normalizeDay(value) {
  const match = String(value || "").match(/\d+/);
  return match ? `day${String(Number(match[0])).padStart(2, "0")}` : "day01";
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function compactAnalysis(analysis) {
  return (analysis.items || []).map(item => ({
    public_id: item.public_id,
    number: item.number,
    orientation: item.orientation,
    visual_summary: item.visual_summary,
    visible_elements: item.visible_elements,
    dominant_subject: item.dominant_subject,
    scene_type: item.scene_type,
    likely_location: item.likely_location,
    location_confidence: item.location_confidence,
    observation_confidence: item.observation_confidence,
    uncertainties: item.uncertainties,
    caption_seed: item.caption_seed,
    editor_note: item.editor_note,
    needs_fact_check: item.needs_fact_check
  }));
}

function validateRecommendation(recommendation, photos) {
  const expectedIds = photos.map(photo => photo.public_id);
  const decisions = recommendation?.decisions;
  if (!decisions || typeof decisions !== "object") {
    throw new Error("analysis.recommendation.decisions missing");
  }

  for (const id of expectedIds) {
    const status = decisions[id]?.status;
    if (!["hero", "story", "backstage", "skip"].includes(status)) {
      throw new Error(`Missing or invalid series decision for ${id}`);
    }
  }

  const extraIds = Object.keys(decisions).filter(id => !expectedIds.includes(id));
  if (extraIds.length) throw new Error(`Unknown public_id in series recommendation: ${extraIds.join(", ")}`);

  const heroIds = expectedIds.filter(id => decisions[id].status === "hero");
  if (heroIds.length !== 1) throw new Error(`Series recommendation must contain exactly one hero, got ${heroIds.length}`);

  return decisions;
}

function responseSchema(photos) {
  const itemProperties = Object.fromEntries(photos.map(photo => [photo.public_id, {
    type: "object",
    additionalProperties: false,
    required: ["label", "note"],
    properties: {
      label: {type: "string", minLength: 1},
      note: {type: "string"}
    }
  }]));

  return {
    name: "travel_journal_review_copy",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["chapter", "items"],
      properties: {
        chapter: {
          type: "object",
          additionalProperties: false,
          required: ["title", "subtitle", "eyebrow", "route_note", "theme", "central_thought", "intro", "fact_checks"],
          properties: {
            title: {type: "string", minLength: 1},
            subtitle: {type: "string", minLength: 1},
            eyebrow: {type: "string", minLength: 1},
            route_note: {type: "string", minLength: 1},
            theme: {type: "string", minLength: 1},
            central_thought: {type: "string", minLength: 1},
            intro: {type: "string", minLength: 1},
            fact_checks: {type: "array", items: {type: "string"}}
          }
        },
        items: {
          type: "object",
          additionalProperties: false,
          required: photos.map(photo => photo.public_id),
          properties: itemProperties
        }
      }
    }
  };
}

function buildReview(raw, photos, decisions) {
  const items = photos.map((photo, index) => {
    const copy = raw.items?.[photo.public_id];
    if (!copy) throw new Error(`Review copy missing public_id: ${photo.public_id}`);
    return {
      public_id: photo.public_id,
      number: index + 1,
      status: decisions[photo.public_id].status,
      label: String(copy.label || "").trim(),
      note: String(copy.note || "").trim()
    };
  });

  const chapter = {
    ...raw.chapter,
    fact_checks: (raw.chapter.fact_checks || []).map(String).map(value => value.trim()).filter(Boolean)
  };

  return {chapter, items};
}

function validateReview(review, photos) {
  const expectedIds = photos.map(photo => photo.public_id);
  const seen = new Set();

  if (!Array.isArray(review?.items)) throw new Error("Review items missing");
  if (review.items.length !== photos.length) {
    throw new Error(`Review must contain all photos: got ${review.items.length}, expected ${photos.length}`);
  }

  for (const item of review.items) {
    if (!expectedIds.includes(item.public_id)) throw new Error(`Unknown public_id: ${item.public_id}`);
    if (seen.has(item.public_id)) throw new Error(`Duplicate public_id: ${item.public_id}`);
    seen.add(item.public_id);
    if (!["hero", "story", "backstage", "skip"].includes(item.status)) throw new Error(`Invalid status: ${item.status}`);
    if (!item.label) throw new Error(`Empty label: ${item.public_id}`);
  }

  const missing = expectedIds.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Missing public_id values: ${missing.join(", ")}`);
  if (review.items.filter(item => item.status === "hero").length !== 1) throw new Error("Exactly one hero required");

  for (const field of ["title", "subtitle", "eyebrow", "route_note", "theme", "central_thought", "intro"]) {
    if (!String(review.chapter?.[field] || "").trim()) throw new Error(`Empty chapter field: ${field}`);
  }

  return review;
}

const photos = await readJson(photosFile);
const analysis = await readJson(analysisFile);
const context = await readJsonIfExists(contextFile);
const authorNotes = await readJsonIfExists(authorNotesFile);

if (!Array.isArray(photos) || !photos.length) throw new Error(`${photosFile} missing photos`);
if (analysis?.schema_version !== 2) throw new Error(`${analysisFile} must be schema_version 2`);
if (!Array.isArray(analysis.items) || analysis.items.length !== photos.length) {
  throw new Error(`Visual analysis must contain all photos: got ${analysis.items?.length || 0}, expected ${photos.length}`);
}

const analysisIds = new Set(analysis.items.map(item => item.public_id));
const missingAnalysis = photos.map(photo => photo.public_id).filter(id => !analysisIds.has(id));
if (missingAnalysis.length) throw new Error(`Visual analysis missing public_id values: ${missingAnalysis.join(", ")}`);

const decisions = validateRecommendation(analysis.recommendation, photos);
const payload = {
  trip,
  day: dayTag,
  photo_count: photos.length,
  context,
  author_notes: authorNotes,
  series_recommendation: {
    sequence_note: analysis.recommendation.sequence_note,
    editorial_summary: analysis.recommendation.editorial_summary,
    fact_checks: analysis.recommendation.fact_checks,
    decisions
  },
  analysis: compactAnalysis(analysis)
};

const prompt = `Ты готовишь текстовое предзаполнение редактора авторского тревел-журнала.

Редакторский отбор уже выполнен после визуального анализа всей серии. Не меняй статусы фотографий. Для каждого public_id создай только:
- label: точное краткое описание фотографии;
- note: что важно рассказать или почему кадр выполняет назначенную роль.

Правила:
- опирайся прежде всего на visual_summary и visible_elements;
- не приписывай фотографии то, чего на ней не видно;
- название локации используй только при location_confidence >= 0.6;
- авторские заметки задают смысл главы, но не меняют содержание кадров;
- chapter должен вытекать из выбранной серии и маршрута;
- текст спокойный, точный, без рекламных оборотов и громких эпитетов;
- для backstage и skip всё равно дай осмысленные label и note;
- не меняй и не пересматривай series_recommendation.decisions.

DATA:
${JSON.stringify(payload, null, 2)}`;

const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json"},
  body: JSON.stringify({
    model,
    temperature: 0.05,
    response_format: {type: "json_schema", json_schema: responseSchema(photos)},
    messages: [{role: "user", content: prompt}]
  })
});

if (!response.ok) throw new Error(`Review v2 error: ${response.status} ${await response.text()}`);
const data = await response.json();
const choice = data.choices?.[0];
console.log(`Review response finish_reason=${choice?.finish_reason || "unknown"}, prompt_tokens=${data.usage?.prompt_tokens || "unknown"}, completion_tokens=${data.usage?.completion_tokens || "unknown"}`);
if (choice?.finish_reason !== "stop") throw new Error(`Review response incomplete: ${choice?.finish_reason || "unknown"}`);
if (!choice?.message?.content) throw new Error("Review response content is empty");

const raw = JSON.parse(choice.message.content);
const review = validateReview(buildReview(raw, photos, decisions), photos);
review.trip = trip;
review.day = dayTag;
review.photos_source = photosFile;
review.analysis_source = analysisFile;
review.context_source = contextFile;
review.author_notes_source = authorNotesFile;
review.status = "ai_review";
review.analysis_schema_version = 2;
review.updated_at = new Date().toISOString();

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", {recursive: true});
await fs.writeFile(outFile, JSON.stringify(review, null, 2), "utf8");
console.log(`Saved AI review for all ${review.items.length} photos using validated series selection to ${outFile}`);
