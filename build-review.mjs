import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");

const photosFile = process.env.PHOTOS_FILE || `data/${trip}/${dayTag}-photos.json`;
const analysisFile = process.env.ANALYSIS_FILE || `data/${trip}/${dayTag}-analysis.json`;
const tripContextFile = process.env.TRIP_CONTEXT_FILE || `data/${trip}/trip-context.json`;
const dayContextFile = process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const ideasFile = process.env.IDEAS_FILE || `data/${trip}/${dayTag}-ideas.json`;
const selectedIdeaFile = process.env.SELECTED_IDEA_FILE || `data/${trip}/${dayTag}-selected-idea.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-ai-review.json`;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY secret is missing");
}

function normalizeDay(value) {
  const raw = String(value || "").trim().toLowerCase();
  const number = raw.match(/\d+/);
  if (number) return `day${String(Number(number[0])).padStart(2, "0")}`;
  return raw.replace(/[^a-z0-9-]/g, "") || "day01";
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw error;
  }
}

function compactAnalysis(analysis) {
  const items = Array.isArray(analysis?.items) ? analysis.items : [];
  return items.map((item) => ({
    public_id: item.public_id,
    number: item.number,
    orientation: item.orientation,
    visual_summary: item.visual_summary,
    likely_subject: item.likely_subject,
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

function compactPhotos(photos) {
  return photos.map((photo, index) => ({
    public_id: photo.public_id,
    number: index + 1,
    width: photo.width,
    height: photo.height,
    created_at: photo.created_at
  }));
}

async function buildAiReview(payload) {
  const prompt = `Ты выпускающий редактор авторского тревел-журнала.

Задача: создать ПРЕДВАРИТЕЛЬНЫЙ ИИ-ОТБОР для редактора, а не финальную публикацию.

Канонический процесс:
1. Фотографии дают визуальный материал.
2. Авторские заметки дают личный смысл дня.
3. Выбранная идея главы является главным законом отбора.
4. AI review предварительно заполняет редактор: статусы кадров, подписи и редакторские комментарии.
5. Автор затем правит этот отбор вручную и экспортирует author-review.

Правила:
- Используй только public_id из списка photos.
- Обязательно ровно 1 hero.
- Story обычно 6-8 кадров, но допускается 9, если это оправдано идеей.
- Backstage — хорошие, но необязательные кадры.
- Skip — дубли и кадры, которые не двигают выбранную идею.
- Текст спокойный, журнальный, без рекламных оборотов.
- Не придумывай факты и географию.
- Если факт требует проверки, добавь его в chapter.fact_checks.
- В note объясняй роль кадра в истории, а не только что на нём видно.

Верни только JSON по схеме:
{
  "trip": "${trip}",
  "day": "${dayTag}",
  "photos_source": "${photosFile}",
  "analysis_source": "${analysisFile}",
  "context_source": "${dayContextFile}",
  "author_notes_source": "${authorNotesFile}",
  "ideas_source": "${ideasFile}",
  "selected_idea_source": "${selectedIdeaFile}",
  "status": "ai_review",
  "updated_at": "ISO_DATE",
  "chapter": {
    "title": "...",
    "subtitle": "...",
    "eyebrow": "День N · дата",
    "route_note": "...",
    "theme": "...",
    "central_thought": "...",
    "intro": "...",
    "fact_checks": ["..."]
  },
  "items": [
    {
      "public_id": "...",
      "number": 1,
      "status": "hero|story|backstage|skip",
      "label": "короткий заголовок кадра",
      "note": "1-3 предложения, роль кадра в главе"
    }
  ]
}

Входные данные:
${JSON.stringify(payload, null, 2)}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI AI review error: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty AI review content");
  return extractJson(content);
}

function validateReview(review, photos) {
  const knownIds = new Set(photos.map((photo) => photo.public_id));
  if (!review || typeof review !== "object") throw new Error("Review is not an object");
  if (!Array.isArray(review.items)) throw new Error("Review items must be an array");

  const seen = new Set();
  for (const item of review.items) {
    if (!knownIds.has(item.public_id)) throw new Error(`Unknown public_id in review: ${item.public_id}`);
    if (seen.has(item.public_id)) throw new Error(`Duplicate public_id in review: ${item.public_id}`);
    seen.add(item.public_id);
    if (!["hero", "story", "backstage", "skip"].includes(item.status)) {
      throw new Error(`Invalid status for ${item.public_id}: ${item.status}`);
    }
  }

  const heroCount = review.items.filter((item) => item.status === "hero").length;
  if (heroCount !== 1) throw new Error(`Review must contain exactly one hero, got ${heroCount}`);

  return review;
}

const photos = await readJsonIfExists(photosFile);
const analysis = await readJsonIfExists(analysisFile);
const tripContext = await readJsonIfExists(tripContextFile);
const dayContext = await readJsonIfExists(dayContextFile);
const authorNotes = await readJsonIfExists(authorNotesFile);
const ideas = await readJsonIfExists(ideasFile);
const selectedIdea = await readJsonIfExists(selectedIdeaFile);

if (!Array.isArray(photos) || !photos.length) throw new Error(`${photosFile} does not contain photos`);
if (!analysis) throw new Error(`${analysisFile} is missing`);
if (!selectedIdea) throw new Error(`${selectedIdeaFile} is missing. Choose a chapter idea before building AI review.`);
if (!authorNotes) throw new Error(`${authorNotesFile} is missing. Add author impressions before building AI review.`);

const payload = {
  trip,
  day: dayTag,
  photos: compactPhotos(photos),
  analysis: compactAnalysis(analysis),
  recommendation: analysis.recommendation || null,
  trip_context: tripContext,
  day_context: dayContext,
  author_notes: authorNotes,
  ideas,
  selected_idea: selectedIdea
};

const review = validateReview(await buildAiReview(payload), photos);
review.trip = trip;
review.day = dayTag;
review.photos_source = photosFile;
review.analysis_source = analysisFile;
review.context_source = dayContextFile;
review.author_notes_source = authorNotesFile;
review.ideas_source = ideasFile;
review.selected_idea_source = selectedIdeaFile;
review.status = "ai_review";
review.updated_at = new Date().toISOString();

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await fs.writeFile(outFile, JSON.stringify(review, null, 2), "utf8");
console.log(`Saved AI review to ${outFile}`);
