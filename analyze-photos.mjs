import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const inFile = process.env.IN_FILE || `data/${trip}/${dayTag}-photos.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-analysis.json`;
const cacheDir = process.env.CACHE_DIR || `data/${trip}/analysis-cache/${dayTag}`;

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

function cachePath(publicId) {
  const safeName = encodeURIComponent(publicId).replace(/%/g, "_");
  return `${cacheDir}/${safeName}.json`;
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

function normalizeAnalysis(photo, raw, index, source = "vision") {
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
    needs_fact_check: Array.isArray(raw.needs_fact_check) ? raw.needs_fact_check.map(String).slice(0, 6) : [],
    analysis_source: source,
    analyzed_at: raw.analyzed_at || new Date().toISOString(),
    model: raw.model || model
  };
}

function isReusableCachedAnalysis(photo, cached) {
  if (!cached || cached.public_id !== photo.public_id) return false;
  if (!cached.visual_summary && !cached.editor_note) return false;
  return true;
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

  return normalizeAnalysis(photo, extractJson(content), index, "vision");
}

function buildAlgorithmicRecommendation(items) {
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
    source: "algorithmic",
    note: "Автоотбор предварительный. Перед публикацией редактор проверяет порядок кадров, подписи и факты."
  };
}

async function buildSeriesRecommendation(items) {
  const fallback = buildAlgorithmicRecommendation(items);
  const compactItems = items.map((item) => ({
    public_id: item.public_id,
    number: item.number,
    orientation: item.orientation,
    visual_summary: item.visual_summary,
    likely_subject: item.likely_subject,
    scores: {
      composition: item.composition_score,
      story: item.story_score,
      emotional: item.emotional_score,
      technical: item.technical_score,
      redundancy: item.redundancy_risk
    },
    suggested_role: item.suggested_role,
    caption_seed: item.caption_seed,
    editor_note: item.editor_note
  }));

  const prompt = `Ты выпускающий фоторедактор авторского тревел-журнала. Ниже — анализ всех кадров одного дня. Составь первичный отбор серии.

Правила:
- 1 главное фото.
- 6-8 фотографий рассказа.
- Остальные хорошие — за кадром.
- Слабые и повторяющиеся — skip.
- Порядок рассказа может отличаться от исходного, если история станет сильнее.
- Не выдумывай географию и факты: если надо проверить, добавь в fact_checks.

Верни только JSON:
{
  "hero": "public_id",
  "story": ["public_id"],
  "backstage": ["public_id"],
  "skip": ["public_id"],
  "sequence_note": "коротко: логика порядка",
  "editorial_summary": "коротко: о чём день визуально",
  "fact_checks": ["что проверить"],
  "source": "series"
}

Кадры:
${JSON.stringify(compactItems, null, 2)}`;

  try {
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
      console.warn(`Series recommendation failed: ${response.status} ${text}`);
      return fallback;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return fallback;
    const raw = extractJson(content);
    const knownIds = new Set(items.map((item) => item.public_id));
    const cleanList = (list) => Array.isArray(list) ? list.map(String).filter((id) => knownIds.has(id)) : [];
    const hero = knownIds.has(raw.hero) ? raw.hero : fallback.hero;
    const story = cleanList(raw.story).filter((id) => id !== hero).slice(0, 8);
    const used = new Set([hero, ...story].filter(Boolean));
    const backstage = cleanList(raw.backstage).filter((id) => !used.has(id));
    backstage.forEach((id) => used.add(id));
    const skip = cleanList(raw.skip).filter((id) => !used.has(id));
    const assigned = new Set([...used, ...skip]);
    for (const item of items) {
      if (!assigned.has(item.public_id)) backstage.push(item.public_id);
    }

    return {
      hero,
      story,
      backstage,
      skip,
      sequence_note: String(raw.sequence_note || "").trim(),
      editorial_summary: String(raw.editorial_summary || "").trim(),
      fact_checks: Array.isArray(raw.fact_checks) ? raw.fact_checks.map(String).slice(0, 12) : [],
      source: "series"
    };
  } catch (error) {
    console.warn(`Series recommendation failed: ${error.message}`);
    return fallback;
  }
}

async function seedCacheFromPreviousOutFile() {
  const previous = await readJsonIfExists(outFile);
  const items = Array.isArray(previous?.items) ? previous.items : [];
  if (!items.length) return new Map();
  return new Map(items.map((item) => [item.public_id, item]));
}

const rawPhotos = await fs.readFile(inFile, "utf8");
const photos = JSON.parse(rawPhotos);
if (!Array.isArray(photos) || photos.length === 0) {
  throw new Error(`${inFile} does not contain photos`);
}

await fs.mkdir(cacheDir, { recursive: true });
const previousById = await seedCacheFromPreviousOutFile();
const items = [];
const stats = { reused_from_cache: 0, reused_from_previous_day_analysis: 0, analyzed_new: 0 };

for (let index = 0; index < photos.length; index += 1) {
  const photo = photos[index];
  const path = cachePath(photo.public_id);
  const cached = await readJsonIfExists(path);

  if (isReusableCachedAnalysis(photo, cached)) {
    console.log(`Reusing cache ${index + 1}/${photos.length}: ${photo.public_id}`);
    items.push(normalizeAnalysis(photo, cached, index, cached.analysis_source || "cache"));
    stats.reused_from_cache += 1;
    continue;
  }

  const previous = previousById.get(photo.public_id);
  if (isReusableCachedAnalysis(photo, previous)) {
    console.log(`Seeding cache from existing day analysis ${index + 1}/${photos.length}: ${photo.public_id}`);
    const seeded = normalizeAnalysis(photo, previous, index, "previous-day-analysis");
    await fs.writeFile(path, JSON.stringify(seeded, null, 2), "utf8");
    items.push(seeded);
    stats.reused_from_previous_day_analysis += 1;
    continue;
  }

  console.log(`Analyzing new photo ${index + 1}/${photos.length}: ${photo.public_id}`);
  const analysis = await analyzePhoto(photo, index, photos.length);
  await fs.writeFile(path, JSON.stringify(analysis, null, 2), "utf8");
  items.push(analysis);
  stats.analyzed_new += 1;
}

const result = {
  trip,
  day: dayTag,
  photos_source: inFile,
  cache_dir: cacheDir,
  generated_at: new Date().toISOString(),
  model,
  cache_stats: stats,
  items,
  recommendation: await buildSeriesRecommendation(items)
};

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await fs.writeFile(outFile, JSON.stringify(result, null, 2), "utf8");

console.log(`Saved analysis for ${items.length} photos to ${outFile}`);
console.log(`Cache stats: ${JSON.stringify(stats)}`);
