import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_VISION_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const inFile = process.env.IN_FILE || `data/${trip}/${dayTag}-photos.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-analysis.json`;
const dayContextFile = process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const schemaVersion = 2;

if (!apiKey) throw new Error("OPENAI_API_KEY secret is missing");

function normalizeDay(value) {
  const m = String(value || "").match(/\d+/);
  return m ? `day${String(Number(m[0])).padStart(2, "0")}` : "day01";
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try { return await readJson(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function imageUrl(url) {
  return url.replace("/image/upload/", "/image/upload/f_auto,q_auto,w_1800/");
}

function extractJson(text) {
  const cleaned = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw error;
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;
}

async function analyzePhoto(photo, index, total, context) {
  const prompt = `Ты выполняешь строгий визуальный анализ фотографии для авторского тревел-журнала.

Кадр ${index + 1} из ${total}.

КРИТИЧЕСКИЙ ПОРЯДОК:
1. Сначала опиши только то, что реально видно на изображении.
2. Отдельно перечисли наблюдаемые элементы: растительность, рельеф, снег, воду, людей, животных, здания, дорогу, небо и погоду.
3. Только затем предложи вероятную локацию из маршрута. Маршрут не должен искажать визуальное описание.
4. Если локация неочевидна, поставь location_confidence ниже 0.6 и напиши «не определена».
5. Не называй зелёные луга пустыней, заснеженные вершины сухими горами, озеро дорогой и наоборот.
6. Не делай редакторский отбор до завершения наблюдения.

Контекст дня:
${JSON.stringify(context || {}, null, 2)}

Верни только JSON:
{
  "visual_summary":"точное описание видимого, 1-3 предложения",
  "visible_elements":{
    "terrain":"",
    "vegetation":"",
    "water":"",
    "snow":"",
    "sky_weather":"",
    "people":"",
    "animals":"",
    "structures":"",
    "road_vehicle":""
  },
  "dominant_subject":"",
  "scene_type":"portrait|animal|meadow|mountain|canyon|lake|road|settlement|other",
  "likely_location":"подтверждённая или вероятная локация; либо не определена",
  "location_confidence":0.0,
  "observation_confidence":0.0,
  "uncertainties":[""],
  "composition_score":0,
  "story_score":0,
  "emotional_score":0,
  "technical_score":0,
  "redundancy_risk":0,
  "suggested_role":"hero|story|backstage|skip",
  "caption_seed":"нейтральная подпись, основанная только на видимом",
  "editor_note":"роль кадра, не подменяя наблюдение интерпретацией",
  "needs_fact_check":[""]
}

Оценки 0-10, confidence 0-1.`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {"Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json"},
    body: JSON.stringify({
      model,
      temperature: 0.05,
      response_format: {type: "json_object"},
      messages: [{role: "user", content: [
        {type: "text", text: prompt},
        {type: "image_url", image_url: {url: imageUrl(photo.url), detail: "high"}}
      ]}]
    })
  });

  if (!response.ok) throw new Error(`Vision error ${photo.public_id}: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const raw = extractJson(data.choices?.[0]?.message?.content || "");

  return {
    schema_version: schemaVersion,
    public_id: photo.public_id,
    number: index + 1,
    url: photo.url,
    width: photo.width,
    height: photo.height,
    orientation: photo.height > photo.width ? "vertical" : photo.width > photo.height ? "horizontal" : "square",
    visual_summary: String(raw.visual_summary || "").trim(),
    visible_elements: raw.visible_elements || {},
    dominant_subject: String(raw.dominant_subject || "").trim(),
    scene_type: String(raw.scene_type || "other").trim(),
    likely_location: String(raw.likely_location || "не определена").trim(),
    location_confidence: Math.max(0, Math.min(1, Number(raw.location_confidence) || 0)),
    observation_confidence: Math.max(0, Math.min(1, Number(raw.observation_confidence) || 0)),
    uncertainties: Array.isArray(raw.uncertainties) ? raw.uncertainties.map(String).filter(Boolean) : [],
    composition_score: num(raw.composition_score),
    story_score: num(raw.story_score),
    emotional_score: num(raw.emotional_score),
    technical_score: num(raw.technical_score),
    redundancy_risk: num(raw.redundancy_risk),
    suggested_role: ["hero","story","backstage","skip"].includes(raw.suggested_role) ? raw.suggested_role : "story",
    caption_seed: String(raw.caption_seed || "").trim(),
    editor_note: String(raw.editor_note || "").trim(),
    needs_fact_check: Array.isArray(raw.needs_fact_check) ? raw.needs_fact_check.map(String).filter(Boolean) : [],
    analysis_source: "vision-v2-high-detail",
    analyzed_at: new Date().toISOString(),
    model
  };
}

async function seriesRecommendation(items, context) {
  const compact = items.map(item => ({
    public_id: item.public_id,
    number: item.number,
    visual_summary: item.visual_summary,
    visible_elements: item.visible_elements,
    scene_type: item.scene_type,
    likely_location: item.likely_location,
    location_confidence: item.location_confidence,
    observation_confidence: item.observation_confidence,
    scores: {composition:item.composition_score, story:item.story_score, emotional:item.emotional_score, technical:item.technical_score, redundancy:item.redundancy_risk}
  }));
  const prompt = `Ты выпускающий фоторедактор. Сделай предварительный отбор только после чтения визуального анализа всех кадров.

Контекст:
${JSON.stringify(context || {}, null, 2)}

Правила:
- визуальное описание важнее предполагаемой локации;
- кадры с location_confidence ниже 0.6 нельзя уверенно подписывать названием места;
- ровно 1 hero;
- 6-8 story, если кадров достаточно;
- финал должен соответствовать авторской сцене, но только если фото действительно это показывает;
- не меняй наблюдаемые луга на пустыню или наоборот;
- порядок локаций сохраняй.

Верни JSON: {"hero":"public_id","story":["public_id"],"backstage":["public_id"],"skip":["public_id"],"sequence_note":"","editorial_summary":"","fact_checks":[""]}

Кадры:
${JSON.stringify(compact, null, 2)}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {"Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json"},
    body: JSON.stringify({model, temperature:0.05, response_format:{type:"json_object"}, messages:[{role:"user",content:prompt}]})
  });
  if (!response.ok) throw new Error(`Series analysis error: ${response.status} ${await response.text()}`);
  return extractJson((await response.json()).choices?.[0]?.message?.content || "");
}

const photos = await readJson(inFile);
if (!Array.isArray(photos) || !photos.length) throw new Error(`${inFile} does not contain photos`);
const context = await readJsonIfExists(dayContextFile);
const items = [];
for (let i=0;i<photos.length;i++) {
  console.log(`Vision v2 ${i+1}/${photos.length}: ${photos[i].public_id}`);
  items.push(await analyzePhoto(photos[i], i, photos.length, context));
}
const result = {
  schema_version: schemaVersion,
  trip,
  day: dayTag,
  photos_source: inFile,
  context_source: context ? dayContextFile : null,
  generated_at: new Date().toISOString(),
  model,
  items,
  recommendation: await seriesRecommendation(items, context)
};
await fs.mkdir(outFile.split("/").slice(0,-1).join("/") || ".", {recursive:true});
await fs.writeFile(outFile, JSON.stringify(result,null,2), "utf8");
console.log(`Saved observation-first analysis for ${items.length} photos to ${outFile}`);
