import fs from "fs/promises";
import {loadEditorialPolicy, policyPrompt, validateEditorialRecommendation} from "./lib/editorial-policy.mjs";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_SERIES_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const analysisFile = process.env.ANALYSIS_FILE || `data/${trip}/${dayTag}-analysis.json`;
const contextFile = process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;

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
    return JSON.parse(choice.message.content);
  }
  throw new Error(`${label}: retries exhausted`);
}

function recommendationSchema(items) {
  const properties = Object.fromEntries(items.map(item => [item.public_id, {
    type: "object", additionalProperties: false,
    required: ["status", "reason", "visual_function", "duplicate_group"],
    properties: {
      status: {type: "string", enum: ["hero", "story", "backstage", "skip"]},
      reason: {type: "string", minLength: 1},
      visual_function: {type: "string", minLength: 1},
      duplicate_group: {type: "string"}
    }
  }]));

  return {
    name: "travel_series_selection",
    strict: true,
    schema: {
      type: "object", additionalProperties: false,
      required: ["decisions", "sequence_note", "editorial_summary", "fact_checks"],
      properties: {
        decisions: {type: "object", additionalProperties: false, required: items.map(item => item.public_id), properties},
        sequence_note: {type: "string", minLength: 1},
        editorial_summary: {type: "string", minLength: 1},
        fact_checks: {type: "array", items: {type: "string"}}
      }
    }
  };
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
    composition: item.composition,
    technical_quality: item.technical_quality,
    likely_location: item.likely_location,
    location_confidence: item.location_confidence,
    caption_seed: item.caption_seed,
    editor_note: item.editor_note
  };
}

function normalizeRecommendation(raw, items) {
  const ids = items.map(item => item.public_id);
  const decisions = raw.decisions;
  return {
    hero: ids.find(id => decisions[id].status === "hero"),
    story: ids.filter(id => decisions[id].status === "story"),
    backstage: ids.filter(id => decisions[id].status === "backstage"),
    skip: ids.filter(id => decisions[id].status === "skip"),
    decisions,
    sequence_note: raw.sequence_note,
    editorial_summary: raw.editorial_summary,
    fact_checks: raw.fact_checks || []
  };
}

const analysis = await readJson(analysisFile);
const context = await readJsonIfExists(contextFile);
const authorNotes = await readJsonIfExists(authorNotesFile);
const policy = await loadEditorialPolicy({trip, dayTag});
const items = analysis.items || [];
if (!items.length) throw new Error(`${analysisFile} has no analyzed photos`);

const compact = items.map(compactItem);
const maxAttempts = policy.retry?.max_editorial_attempts ?? 3;
let validationErrors = [];
let accepted = null;

for (let attempt = 1; attempt <= maxAttempts; attempt++) {
  const correction = validationErrors.length
    ? `\nПРЕДЫДУЩИЙ ВАРИАНТ ОТКЛОНЁН ВАЛИДАТОРОМ:\n- ${validationErrors.join("\n- ")}\nИсправь все нарушения.`
    : "";

  const prompt = `Ты выпускающий фоторедактор авторского журнала. Выполни отбор всей серии после визуального анализа всех кадров.

Сначала сравни кадры по композиции, визуальной силе, уникальности функции и ритму. Авторские заметки задают смысл, но не должны заставлять фотографии иллюстрировать заранее придуманную схему.

Общие правила:
- решение обязательно для каждого public_id;
- hero — самый сильный самостоятельный кадр;
- backstage — хорошие второстепенные кадры;
- skip — слабые и лишние повторы;
- duplicate_group — смысловое название группы, не public_id;
- финальная сцена влияет на порядок, но не обязана быть hero;
- причины должны сравнивать кадр с реальными дублями;
- не придумывай культуру, быт и символический смысл;
- пиши только по-русски.
${policyPrompt(policy)}
${correction}

КОНТЕКСТ:
${JSON.stringify(context || {}, null, 2)}

АВТОРСКИЕ ЗАМЕТКИ:
${JSON.stringify(authorNotes || {}, null, 2)}

КАДРЫ:
${JSON.stringify(compact, null, 2)}`;

  const raw = await callStructured(prompt, recommendationSchema(items), `Series selection attempt ${attempt}`);
  const validation = validateEditorialRecommendation(raw, items, policy);
  if (validation.ok) {
    accepted = normalizeRecommendation(raw, items);
    break;
  }
  validationErrors = validation.errors;
  console.warn(`Editorial validation failed on attempt ${attempt}: ${validationErrors.join("; ")}`);
}

if (!accepted) {
  throw new Error(`Editorial selection failed project policy after ${maxAttempts} attempts: ${validationErrors.join("; ")}`);
}

analysis.recommendation = accepted;
analysis.editorial_policy = {
  source: "config/editorial-policy.json",
  version: policy.version,
  validated: true,
  model,
  updated_at: new Date().toISOString()
};
analysis.series_model = model;
analysis.generated_at = new Date().toISOString();

await fs.writeFile(analysisFile, JSON.stringify(analysis, null, 2), "utf8");
console.log(`Saved policy-validated series selection for ${items.length} photos to ${analysisFile}`);
