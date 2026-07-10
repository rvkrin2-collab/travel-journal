import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
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
  try { return await readJson(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function containsLatinText(value) {
  const cleaned = String(value || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bIMG\d+_[A-Za-z0-9]+\b/g, " ")
    .replace(/\b(?:hero|story|backstage|skip)\b/gi, " ");
  return /[A-Za-z]{4,}/.test(cleaned);
}

function assertRussian(value, field) {
  if (containsLatinText(value)) throw new Error(`${field} must be written in Russian`);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function callStructured(prompt, schema, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
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

    if (response.status === 429 && attempt < 5) {
      const body = await response.text();
      const seconds = Number(body.match(/try again in\s+([\d.]+)s/i)?.[1] || 2 ** attempt * 2);
      await sleep(Math.ceil(seconds * 1000) + 500);
      continue;
    }

    if (!response.ok) throw new Error(`${label} error: ${response.status} ${await response.text()}`);
    const data = await response.json();
    const choice = data.choices?.[0];
    console.log(`${label} finish_reason=${choice?.finish_reason || "unknown"}, prompt_tokens=${data.usage?.prompt_tokens || "unknown"}, completion_tokens=${data.usage?.completion_tokens || "unknown"}`);
    if (choice?.finish_reason !== "stop") throw new Error(`${label} incomplete: ${choice?.finish_reason || "unknown"}`);
    if (!choice?.message?.content) throw new Error(`${label} content is empty`);
    return JSON.parse(choice.message.content);
  }
  throw new Error(`${label}: retries exhausted`);
}

const chapterSchema = {
  name: "travel_journal_chapter_copy",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
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

function validateRecommendation(recommendation, photos) {
  const ids = photos.map(photo => photo.public_id);
  const decisions = recommendation?.decisions;
  if (!decisions) throw new Error("analysis.recommendation.decisions missing");
  for (const id of ids) {
    if (!["hero", "story", "backstage", "skip"].includes(decisions[id]?.status)) {
      throw new Error(`Missing or invalid decision for ${id}`);
    }
  }
  if (ids.filter(id => decisions[id].status === "hero").length !== 1) throw new Error("Exactly one hero required");
  return decisions;
}

const photos = await readJson(photosFile);
const analysis = await readJson(analysisFile);
const context = await readJsonIfExists(contextFile);
const authorNotes = await readJsonIfExists(authorNotesFile);

if (!Array.isArray(photos) || !photos.length) throw new Error(`${photosFile} missing photos`);
if (!Array.isArray(analysis?.items) || analysis.items.length !== photos.length) {
  throw new Error(`Analysis must contain all photos: got ${analysis?.items?.length || 0}, expected ${photos.length}`);
}

const analysisById = new Map(analysis.items.map(item => [item.public_id, item]));
const missing = photos.map(photo => photo.public_id).filter(id => !analysisById.has(id));
if (missing.length) throw new Error(`Analysis missing: ${missing.join(", ")}`);

const decisions = validateRecommendation(analysis.recommendation, photos);
const selected = analysis.items
  .filter(item => ["hero", "story"].includes(decisions[item.public_id].status))
  .map(item => ({
    public_id: item.public_id,
    status: decisions[item.public_id].status,
    visual_summary: item.visual_summary,
    caption_seed: item.caption_seed,
    editor_note: item.editor_note,
    likely_location: item.likely_location,
    location_confidence: item.location_confidence
  }));

const prompt = `Напиши только текст главы авторского тревел-журнала. Пиши только по-русски.

Правила:
- опирайся только на выбранные кадры, маршрут и авторские заметки;
- 1-3 коротких предложения во вступлении;
- без рекламных и типичных ИИ-оборотов;
- не используй слова «величие», «гармония», «живописный», «уникальный», «насладиться», «погружаемся»;
- не превращай дорогу, лошадей и пейзаж в символы;
- не придумывай быт, традиции и действия людей;
- название места используй только при location_confidence >= 0.6;
- fact_checks — только реальные внешние факты, иначе пустой массив.

DATA:
${JSON.stringify({trip, day: dayTag, context, author_notes: authorNotes, selected, series: analysis.recommendation}, null, 2)}`;

const chapter = await callStructured(prompt, chapterSchema, "Chapter copy");
for (const field of ["title", "subtitle", "eyebrow", "route_note", "theme", "central_thought", "intro"]) {
  if (!String(chapter[field] || "").trim()) throw new Error(`Empty chapter field: ${field}`);
  assertRussian(chapter[field], `Chapter ${field}`);
}
chapter.fact_checks = (chapter.fact_checks || []).map(String).map(value => value.trim()).filter(Boolean);
for (const fact of chapter.fact_checks) assertRussian(fact, "Chapter fact_check");

const items = photos.map((photo, index) => {
  const item = analysisById.get(photo.public_id);
  const decision = decisions[photo.public_id];
  const label = String(item.caption_seed || item.visual_summary || "").trim();
  const note = String(decision.reason || item.editor_note || "").trim();
  if (!label) throw new Error(`Empty label: ${photo.public_id}`);
  assertRussian(label, `Label ${photo.public_id}`);
  assertRussian(note, `Note ${photo.public_id}`);
  return {
    public_id: photo.public_id,
    number: index + 1,
    status: decision.status,
    label,
    note
  };
});

const review = {
  chapter,
  items,
  trip,
  day: dayTag,
  photos_source: photosFile,
  analysis_source: analysisFile,
  context_source: contextFile,
  author_notes_source: authorNotesFile,
  status: "ai_review",
  analysis_schema_version: analysis.schema_version,
  updated_at: new Date().toISOString(),
  generation: {
    model,
    chapter_requests: 1,
    photo_copy_requests: 0
  }
};

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", {recursive: true});
await fs.writeFile(outFile, JSON.stringify(review, null, 2), "utf8");
console.log(`Saved AI review for ${items.length} photos with one text request`);
