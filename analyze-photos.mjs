import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const inFile = process.env.IN_FILE || `data/${trip}/${dayTag}-photos.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-analysis.json`;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY secret is missing");
}

function normalizeDay(value) {
  const raw = String(value || "").trim().toLowerCase();
  const number = raw.match(/\d+/);
  if (number) return `day${String(Number(number[0])).padStart(2, "0")}`;
  return raw.replace(/[^a-z0-9-]/g, "") || "day01";
}

function imageUrl(url) {
  return url.replace("/image/upload/", "/image/upload/f_auto,q_auto,w_1400/");
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw error;
  }
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeAnalysis(photo, raw, index) {
  return {
    public_id: photo.public_id,
    number: index + 1,
    url: photo.url,
    width: photo.width,
    height: photo.height,
    orientation: photo.height > photo.width ? "vertical" : photo.width > photo.height ? "horizontal" : "square",
    visual_summary: String(raw.visual_summary || "").trim(),
    likely_subject: String(raw.likely_subject || "").trim(),
    place_hints: Array.isArray(raw.place_hints) ? raw.place_hints.map(String).slice(0, 6) : [],
    people: Boolean(raw.people),
    landscape: Boolean(raw.landscape),
    architecture: Boolean(raw.architecture),
    interior: Boolean(raw.interior),
    vehicle_or_road: Boolean(raw.vehicle_or_road),
    food: Boolean(raw.food),
    animal: Boolean(raw.animal),
    composition_score: safeNumber(raw.composition_score),
    story_score: safeNumber(raw.story_score),
    emotional_score: safeNumber(raw.emotional_score),
    technical_score: safeNumber(raw.technical_score),
    redundancy_risk: safeNumber(raw.redundancy_risk),
    suggested_role: ["hero", "story", "backstage", "skip"].includes(raw.suggested_role) ? raw.suggested_role : "story",
    caption_seed: String(raw.caption_seed || "").trim(),
    editor_note: String(raw.editor_note || "").trim(),
    needs_fact_check: Array.isArray(raw.needs_fact_check) ? raw.needs_fact_check.map(String).slice(0, 6) : []
  };
}

async function analyzePhoto(photo, index, total) {
  const prompt = `Ты фоторедактор авторского тревел-журнала. Проанализируй кадр ${index + 1} из ${total}.

Стиль журнала: спокойный, интеллектуальный, визуальный. Фотография рассказывает историю, текст только усиливает кадр. Не используй рекламные обороты.

Верни только JSON без Markdown по схеме:
{
  "visual_summary": "1-2 предложения: что видно на фотографии",
  "likely_subject": "главный объект кадра",
  "place_hints": ["географические или культурные подсказки, если видны"],
  "people": false,
  "landscape": false,
  "architecture": false,
  "interior": false,
  "vehicle_or_road": false,
  "food": false,
  "animal": false,
  "composition_score": 0,
  "story_score": 0,
  "emotional_score": 0,
  "technical_score": 0,
  "redundancy_risk": 0,
  "suggested_role": "hero|story|backstage|skip",
  "caption_seed": "короткая журнальная подпись на русском, 1 предложение",
  "editor_note": "почему этот кадр нужен или не нужен в рассказе",
  "needs_fact_check": ["что надо проверить перед публикацией"]
}

Оценки 0-10. redundancy_risk: 0 — уникальный кадр, 10 — вероятно дубль или слабое повторение.`;

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
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl(photo.url), detail: "low" } }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI error for ${photo.public_id}: ${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(`OpenAI returned empty content for ${photo.public_id}`);
  }

  return normalizeAnalysis(photo, extractJson(content), index);
}

function buildRecommendation(items) {
  const sorted = [...items].sort((a, b) => {
    const scoreA = a.story_score + a.composition_score + a.emotional_score + a.technical_score - a.redundancy_risk * 0.5;
    const scoreB = b.story_score + b.composition_score + b.emotional_score + b.technical_score - b.redundancy_risk * 0.5;
    return scoreB - scoreA;
  });

  const hero = sorted.find((item) => item.suggested_role === "hero") || sorted[0] || null;
  const story = sorted
    .filter((item) => item.public_id !== hero?.public_id && item.suggested_role !== "skip")
    .slice(0, 8);
  const selectedIds = new Set([hero?.public_id, ...story.map((item) => item.public_id)].filter(Boolean));
  const backstage = sorted
    .filter((item) => !selectedIds.has(item.public_id) && item.suggested_role !== "skip")
    .slice(0, 12);
  const skip = items.filter((item) => item.suggested_role === "skip" || (!selectedIds.has(item.public_id) && !backstage.some((b) => b.public_id === item.public_id)));

  return {
    hero: hero ? hero.public_id : null,
    story: story.map((item) => item.public_id),
    backstage: backstage.map((item) => item.public_id),
    skip: skip.map((item) => item.public_id),
    note: "Автоотбор предварительный. Перед публикацией редактор проверяет порядок кадров, подписи и факты."
  };
}

const rawPhotos = await fs.readFile(inFile, "utf8");
const photos = JSON.parse(rawPhotos);
if (!Array.isArray(photos) || photos.length === 0) {
  throw new Error(`${inFile} does not contain photos`);
}

const items = [];
for (let index = 0; index < photos.length; index += 1) {
  const photo = photos[index];
  console.log(`Analyzing ${index + 1}/${photos.length}: ${photo.public_id}`);
  const analysis = await analyzePhoto(photo, index, photos.length);
  items.push(analysis);
}

const result = {
  trip,
  day: dayTag,
  photos_source: inFile,
  generated_at: new Date().toISOString(),
  model,
  items,
  recommendation: buildRecommendation(items)
};

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await fs.writeFile(outFile, JSON.stringify(result, null, 2), "utf8");

console.log(`Saved analysis for ${items.length} photos to ${outFile}`);
