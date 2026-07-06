import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");

const photosFile = process.env.PHOTOS_FILE || `data/${trip}/${dayTag}-photos.json`;
const aiReviewFile = process.env.AI_REVIEW_FILE || `data/${trip}/${dayTag}-ai-review.json`;
const authorReviewFile = process.env.AUTHOR_REVIEW_FILE || `data/${trip}/${dayTag}-author-review.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const selectedIdeaFile = process.env.SELECTED_IDEA_FILE || `data/${trip}/${dayTag}-selected-idea.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-final-review.json`;

if (!apiKey) throw new Error("OPENAI_API_KEY secret is missing");

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

function validateReview(review, photos) {
  const knownIds = new Set(photos.map((photo) => photo.public_id));
  if (!review || typeof review !== "object") throw new Error("Final review is not an object");
  if (!Array.isArray(review.items)) throw new Error("Final review items must be an array");
  const seen = new Set();
  for (const item of review.items) {
    if (!knownIds.has(item.public_id)) throw new Error(`Unknown public_id in final review: ${item.public_id}`);
    if (seen.has(item.public_id)) throw new Error(`Duplicate public_id in final review: ${item.public_id}`);
    seen.add(item.public_id);
    if (!["hero", "story", "backstage", "skip"].includes(item.status)) {
      throw new Error(`Invalid final status for ${item.public_id}: ${item.status}`);
    }
  }
  const heroCount = review.items.filter((item) => item.status === "hero").length;
  if (heroCount !== 1) throw new Error(`Final review must contain exactly one hero, got ${heroCount}`);
  return review;
}

async function buildFinalReview(payload) {
  const prompt = `Ты редактор авторского тревел-журнала. Твоя задача — собрать ФИНАЛЬНЫЙ REVIEW для preview.

Иерархия решений:
1. AUTHOR REVIEW — главный источник. Авторский статус кадра, выбор и порядок нельзя менять без очень веской причины.
2. SELECTED IDEA — смысловая основа главы.
3. AUTHOR NOTES — личные впечатления автора.
4. AI REVIEW — только вспомогательный черновик.

Что можно делать:
- Улучшать формулировки label и note.
- Делать подписи точнее, спокойнее, журнальнее.
- Сохранять авторскую структуру и статусы.
- Добавлять fact_checks.

Что нельзя делать:
- Нельзя менять статусы кадров из author-review без крайней необходимости.
- Нельзя добавлять public_id, которых нет в author-review/photos.
- Нельзя придумывать географию.
- Нельзя публицистический пафос и рекламные обороты.

Верни только JSON по схеме final-review:
{
  "trip": "${trip}",
  "day": "${dayTag}",
  "photos_source": "${photosFile}",
  "ai_review_source": "${aiReviewFile}",
  "author_review_source": "${authorReviewFile}",
  "author_notes_source": "${authorNotesFile}",
  "selected_idea_source": "${selectedIdeaFile}",
  "status": "final_review",
  "updated_at": "ISO_DATE",
  "chapter": {
    "title": "...",
    "subtitle": "...",
    "eyebrow": "...",
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
      "label": "...",
      "note": "..."
    }
  ]
}

Входные данные:
${JSON.stringify(payload, null, 2)}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {"Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json"},
    body: JSON.stringify({model, temperature: 0.15, response_format: { type: "json_object" }, messages: [{ role: "user", content: prompt }]})
  });
  if (!response.ok) throw new Error(`OpenAI final review error: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty final review content");
  return extractJson(content);
}

const photos = await readJsonIfExists(photosFile);
const aiReview = await readJsonIfExists(aiReviewFile) || await readJsonIfExists(`data/${trip}/${dayTag}-review.json`);
const authorReview = await readJsonIfExists(authorReviewFile);
const authorNotes = await readJsonIfExists(authorNotesFile);
const selectedIdea = await readJsonIfExists(selectedIdeaFile);

if (!Array.isArray(photos) || !photos.length) throw new Error(`${photosFile} does not contain photos`);
if (!authorReview) throw new Error(`${authorReviewFile} is missing. Export author-review from editor first.`);

const payload = {trip, day: dayTag, photos, ai_review: aiReview, author_review: authorReview, author_notes: authorNotes, selected_idea: selectedIdea};
const finalReview = validateReview(await buildFinalReview(payload), photos);
finalReview.trip = trip;
finalReview.day = dayTag;
finalReview.photos_source = photosFile;
finalReview.ai_review_source = aiReviewFile;
finalReview.author_review_source = authorReviewFile;
finalReview.author_notes_source = authorNotesFile;
finalReview.selected_idea_source = selectedIdeaFile;
finalReview.status = "final_review";
finalReview.updated_at = new Date().toISOString();

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await fs.writeFile(outFile, JSON.stringify(finalReview, null, 2), "utf8");
console.log(`Saved final review to ${outFile}`);
