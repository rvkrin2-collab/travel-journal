import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o";
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

function compactItem(item) {
  return {
    public_id: item.public_id,
    number: item.number,
    orientation: item.orientation,
    visual_summary: item.visual_summary,
    foreground: item.foreground,
    midground: item.midground,
    background: item.background,
    visible_elements: item.visible_elements,
    dominant_subject: item.dominant_subject,
    secondary_subjects: item.secondary_subjects,
    scene_type: item.scene_type,
    people_count: item.people_count,
    animal_count: item.animal_count,
    light: item.light,
    weather: item.weather,
    composition: item.composition,
    technical_quality: item.technical_quality,
    likely_location: item.likely_location,
    location_confidence: item.location_confidence,
    location_reason: item.location_reason,
    observation_confidence: item.observation_confidence,
    uncertainties: item.uncertainties,
    caption_seed: item.caption_seed,
    needs_fact_check: item.needs_fact_check
  };
}

function validateRecommendation(recommendation, photos) {
  const expectedIds = photos.map(photo => photo.public_id);
  const decisions = recommendation?.decisions;
  if (!decisions || typeof decisions !== "object") throw new Error("analysis.recommendation.decisions missing");

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

const chapterSchema = {
  name: "travel_journal_chapter_copy",
  strict: true,
  schema: {
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
  }
};

const itemSchema = {
  name: "travel_journal_photo_copy",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["public_id", "label", "note"],
    properties: {
      public_id: {type: "string", minLength: 1},
      label: {type: "string", minLength: 1},
      note: {type: "string"}
    }
  }
};

async function callStructured(prompt, schema, logLabel) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: {type: "json_schema", json_schema: schema},
      messages: [{role: "user", content: prompt}]
    })
  });

  if (!response.ok) throw new Error(`${logLabel} error: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const choice = data.choices?.[0];
  console.log(`${logLabel} finish_reason=${choice?.finish_reason || "unknown"}, prompt_tokens=${data.usage?.prompt_tokens || "unknown"}, completion_tokens=${data.usage?.completion_tokens || "unknown"}`);
  if (choice?.finish_reason !== "stop") throw new Error(`${logLabel} incomplete: ${choice?.finish_reason || "unknown"}`);
  if (!choice?.message?.content) throw new Error(`${logLabel} content is empty`);
  return JSON.parse(choice.message.content);
}

function containsLatinText(value) {
  return /[A-Za-z]{4,}/.test(String(value || ""));
}

function validateRussianText(value, field) {
  if (containsLatinText(value)) throw new Error(`${field} must be written in Russian`);
}

function validateReview(review, photos) {
  const expectedIds = photos.map(photo => photo.public_id);
  if (!Array.isArray(review.items) || review.items.length !== photos.length) {
    throw new Error(`Review must contain all photos: got ${review.items?.length || 0}, expected ${photos.length}`);
  }

  const seen = new Set();
  for (const item of review.items) {
    if (!expectedIds.includes(item.public_id)) throw new Error(`Unknown public_id: ${item.public_id}`);
    if (seen.has(item.public_id)) throw new Error(`Duplicate public_id: ${item.public_id}`);
    seen.add(item.public_id);
    if (!["hero", "story", "backstage", "skip"].includes(item.status)) throw new Error(`Invalid status: ${item.status}`);
    if (!String(item.label || "").trim()) throw new Error(`Empty label: ${item.public_id}`);
    validateRussianText(item.label, `Label ${item.public_id}`);
    validateRussianText(item.note, `Note ${item.public_id}`);
  }

  const missing = expectedIds.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Missing public_id values: ${missing.join(", ")}`);
  if (review.items.filter(item => item.status === "hero").length !== 1) throw new Error("Exactly one hero required");

  for (const field of ["title", "subtitle", "eyebrow", "route_note", "theme", "central_thought", "intro"]) {
    if (!String(review.chapter?.[field] || "").trim()) throw new Error(`Empty chapter field: ${field}`);
    validateRussianText(review.chapter[field], `Chapter ${field}`);
  }
  for (const fact of review.chapter.fact_checks || []) validateRussianText(fact, "Chapter fact_check");
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

const analysisById = new Map(analysis.items.map(item => [item.public_id, item]));
const missingAnalysis = photos.map(photo => photo.public_id).filter(id => !analysisById.has(id));
if (missingAnalysis.length) throw new Error(`Visual analysis missing public_id values: ${missingAnalysis.join(", ")}`);

const decisions = validateRecommendation(analysis.recommendation, photos);
const selected = analysis.items
  .filter(item => ["hero", "story"].includes(decisions[item.public_id].status))
  .map(compactItem);

const chapterPrompt = `Ты пишешь текст главы авторского тревел-журнала после завершённого визуального анализа и редакторского отбора всей серии.

ПИШИ ТОЛЬКО ПО-РУССКИ во всех текстовых полях.

Правила:
- история должна вытекать из реально выбранных фотографий;
- авторские заметки задают смысл, но не меняют содержание кадров;
- сохраняй реальный порядок маршрута;
- intro — 1-3 коротких предложения;
- не используй рекламные, туристические и типичные ИИ-обороты;
- запрещены слова и обороты: «идеально передаёт», «величие природы», «гармония с природой», «уникальный», «живописный», «насладиться», «погружаемся», «бескрайняя красота»;
- не превращай наблюдение в символ: дорога не обязана «символизировать путь», лошади не обязаны «символизировать свободу»;
- не придумывай быт, традиции, назначение предметов и занятия людей;
- географическое название используй только там, где location_confidence >= 0.6;
- fact_checks включают только реальные внешние факты для публикации; не добавляй проверки того, что уже видно на фотографии. Если таких фактов нет, верни пустой массив.

DATA:
${JSON.stringify({
  trip,
  day: dayTag,
  context,
  author_notes: authorNotes,
  series_recommendation: analysis.recommendation,
  selected_analysis: selected
}, null, 2)}`;

const chapter = await callStructured(chapterPrompt, chapterSchema, "Chapter copy");
chapter.fact_checks = (chapter.fact_checks || []).map(String).map(value => value.trim()).filter(Boolean);

const items = [];
for (let index = 0; index < photos.length; index++) {
  const photo = photos[index];
  const visual = compactItem(analysisById.get(photo.public_id));
  const decision = decisions[photo.public_id];
  console.log(`Review copy ${index + 1}/${photos.length}: ${photo.public_id}`);

  const itemPrompt = `Ты пишешь предзаполнение редактора для ОДНОЙ фотографии тревел-журнала.

ПИШИ ТОЛЬКО ПО-РУССКИ во всех текстовых полях.

Критически важно:
- работай только с public_id ${photo.public_id};
- label должен буквально и кратко описывать именно эту фотографию;
- note — одно или два коротких предложения о роли кадра в серии;
- не переноси объекты, людей, животных или локации из соседних кадров;
- не называй неясный предмет конкретным устройством или вещью;
- если предмет не опознан уверенно, пиши «предмет», «оборудование» или «неясный объект»;
- название локации используй только при location_confidence >= 0.6;
- статус уже выбран и не подлежит изменению;
- не пересказывай всю тему главы в каждой карточке;
- не используй слова и обороты: «идеально передаёт», «величие», «гармония», «символизирует», «уникальный», «живописный», «насладиться»;
- не придумывай культурное значение, образ жизни, назначение предметов и действия людей;
- для skip и backstage объясни конкретную визуальную причину: дубль, слабая композиция, отсутствие новой функции или технический недостаток.

DATA:
${JSON.stringify({
  public_id: photo.public_id,
  number: index + 1,
  status: decision.status,
  selection_reason: decision.reason,
  visual_analysis: visual,
  chapter: {
    title: chapter.title,
    theme: chapter.theme,
    central_thought: chapter.central_thought
  },
  author_notes: authorNotes
}, null, 2)}`;

  const copy = await callStructured(itemPrompt, itemSchema, `Photo copy ${photo.public_id}`);
  if (copy.public_id !== photo.public_id) {
    throw new Error(`Photo copy public_id mismatch: got ${copy.public_id}, expected ${photo.public_id}`);
  }

  items.push({
    public_id: photo.public_id,
    number: index + 1,
    status: decision.status,
    label: String(copy.label || "").trim(),
    note: String(copy.note || "").trim()
  });
}

const review = validateReview({chapter, items}, photos);
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
console.log(`Saved isolated per-photo AI review for all ${review.items.length} photos to ${outFile}`);
