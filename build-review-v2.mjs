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
    suggested_role: item.suggested_role,
    composition_score: item.composition_score,
    story_score: item.story_score,
    emotional_score: item.emotional_score,
    technical_score: item.technical_score,
    redundancy_risk: item.redundancy_risk,
    caption_seed: item.caption_seed,
    editor_note: item.editor_note,
    needs_fact_check: item.needs_fact_check
  }));
}

function decisionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "label", "note"],
    properties: {
      status: {type: "string", enum: ["hero", "story", "backstage", "skip"]},
      label: {type: "string", minLength: 1},
      note: {type: "string"}
    }
  };
}

function buildResponseSchema(photos) {
  const decisionProperties = Object.fromEntries(
    photos.map(photo => [photo.public_id, decisionSchema()])
  );

  return {
    name: "travel_journal_ai_review",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["chapter", "decisions"],
      properties: {
        chapter: {
          type: "object",
          additionalProperties: false,
          required: [
            "title",
            "subtitle",
            "eyebrow",
            "route_note",
            "theme",
            "central_thought",
            "intro",
            "fact_checks"
          ],
          properties: {
            title: {type: "string", minLength: 1},
            subtitle: {type: "string", minLength: 1},
            eyebrow: {type: "string", minLength: 1},
            route_note: {type: "string", minLength: 1},
            theme: {type: "string", minLength: 1},
            central_thought: {type: "string", minLength: 1},
            intro: {type: "string", minLength: 1},
            fact_checks: {
              type: "array",
              items: {type: "string"}
            }
          }
        },
        decisions: {
          type: "object",
          additionalProperties: false,
          required: photos.map(photo => photo.public_id),
          properties: decisionProperties
        }
      }
    }
  };
}

function toReview(raw, photos) {
  const items = photos.map((photo, index) => {
    const decision = raw.decisions?.[photo.public_id];
    if (!decision) throw new Error(`Structured output missing public_id: ${photo.public_id}`);
    return {
      public_id: photo.public_id,
      number: index + 1,
      status: decision.status,
      label: decision.label.trim(),
      note: decision.note.trim()
    };
  });

  return {
    chapter: {
      ...raw.chapter,
      fact_checks: (raw.chapter.fact_checks || []).map(String).map(value => value.trim()).filter(Boolean)
    },
    items
  };
}

function validate(review, photos) {
  const expectedIds = new Set(photos.map(photo => photo.public_id));
  const seen = new Set();

  if (!Array.isArray(review?.items)) throw new Error("Review items missing");
  if (review.items.length !== photos.length) {
    throw new Error(`Review must contain all photos: got ${review.items.length}, expected ${photos.length}`);
  }

  for (const item of review.items) {
    if (!expectedIds.has(item.public_id)) throw new Error(`Unknown public_id: ${item.public_id}`);
    if (seen.has(item.public_id)) throw new Error(`Duplicate public_id: ${item.public_id}`);
    seen.add(item.public_id);
    if (!["hero", "story", "backstage", "skip"].includes(item.status)) {
      throw new Error(`Invalid status: ${item.status}`);
    }
    if (!String(item.label || "").trim()) throw new Error(`Empty label: ${item.public_id}`);
  }

  if (review.items.filter(item => item.status === "hero").length !== 1) {
    throw new Error("Exactly one hero required");
  }

  for (const id of expectedIds) {
    if (!seen.has(id)) throw new Error(`Missing public_id: ${id}`);
  }

  const chapter = review.chapter || {};
  for (const field of ["title", "subtitle", "eyebrow", "route_note", "theme", "central_thought", "intro"]) {
    if (!String(chapter[field] || "").trim()) throw new Error(`Empty chapter field: ${field}`);
  }

  return review;
}

const photos = await readJson(photosFile);
const analysis = await readJson(analysisFile);
const context = await readJsonIfExists(contextFile);
const authorNotes = await readJsonIfExists(authorNotesFile);

if (!Array.isArray(photos) || !photos.length) throw new Error(`${photosFile} missing photos`);
if (analysis?.schema_version !== 2) throw new Error(`${analysisFile} must be schema_version 2`);

const analysisById = new Set((analysis.items || []).map(item => item.public_id));
for (const photo of photos) {
  if (!analysisById.has(photo.public_id)) {
    throw new Error(`Visual analysis missing for photo: ${photo.public_id}`);
  }
}

const payload = {
  trip,
  day: dayTag,
  photo_count: photos.length,
  required_public_ids: photos.map(photo => photo.public_id),
  context,
  author_notes: authorNotes,
  photos: photos.map((photo, index) => ({
    public_id: photo.public_id,
    number: index + 1,
    width: photo.width,
    height: photo.height
  })),
  analysis: compactAnalysis(analysis)
};

const prompt = `Ты создаёшь предварительное заполнение редактора авторского тревел-журнала.

Вход содержит ${photos.length} фотографий. Для КАЖДОГО public_id из required_public_ids прими отдельное редакторское решение.

ЖЁСТКИЕ ПРАВИЛА:
- Основа подписи — visual_summary и visible_elements.
- Нельзя противоречить наблюдаемому: зелёные луга нельзя назвать пустыней, снег нельзя игнорировать, животное нельзя заменить пейзажем.
- likely_location можно использовать в label только при location_confidence >= 0.6.
- При низкой уверенности используй нейтральную подпись без названия места.
- Авторские заметки определяют смысл и финал, но не меняют содержание фотографии.
- Ровно 1 hero. Обычно 6–8 story. Остальные backstage или skip.
- Финальная сцена автора должна быть в story, если фотография визуально ей соответствует.
- Порядок локаций следует actual_route_order.
- Не придумывай факты.
- Не исключай фотографии из ответа: статус backstage или skip тоже является полноценным решением.

DATA:
${JSON.stringify(payload, null, 2)}`;

const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    model,
    temperature: 0.05,
    response_format: {
      type: "json_schema",
      json_schema: buildResponseSchema(photos)
    },
    messages: [{role: "user", content: prompt}]
  })
});

if (!response.ok) {
  throw new Error(`Review v2 error: ${response.status} ${await response.text()}`);
}

const data = await response.json();
const choice = data.choices?.[0];
console.log(`Review response finish_reason=${choice?.finish_reason || "unknown"}, prompt_tokens=${data.usage?.prompt_tokens || "unknown"}, completion_tokens=${data.usage?.completion_tokens || "unknown"}`);

if (choice?.finish_reason !== "stop") {
  throw new Error(`Review response did not finish normally: ${choice?.finish_reason || "unknown"}`);
}

const content = choice?.message?.content;
if (!content) throw new Error("Review response content is empty");

const raw = JSON.parse(content);
const review = validate(toReview(raw, photos), photos);

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
console.log(`Saved complete observation-grounded AI review with ${review.items.length}/${photos.length} photos to ${outFile}`);
