import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const visionModel = process.env.OPENAI_VISION_MODEL || "gpt-4o";
const textModel = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const inFile = process.env.IN_FILE || `data/${trip}/${dayTag}-photos.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-analysis.json`;
const contextFile = process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const schemaVersion = 3;
const analysisVersion = "combined-vision-v1";

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

function imageUrl(url) {
  return url.replace("/image/upload/", "/image/upload/f_auto,q_auto,w_2200/");
}

function cacheKey(photo) {
  return [analysisVersion, visionModel, photo.public_id, photo.url, photo.width, photo.height].join("|");
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

async function callStructured({model, prompt, schema, image, label}) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const content = [{type: "text", text: prompt}];
    if (image) content.push({type: "image_url", image_url: {url: image, detail: "high"}});

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json"},
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {type: "json_schema", json_schema: schema},
        messages: [{role: "user", content}]
      })
    });

    if (response.status === 429 && attempt < 5) {
      const body = await response.text();
      const seconds = Number(body.match(/try again in\s+([\d.]+)s/i)?.[1] || 2 ** attempt * 2);
      const delay = Math.ceil(seconds * 1000) + 500;
      console.warn(`${label}: rate limit, retry in ${delay} ms`);
      await sleep(delay);
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

const photoSchema = {
  name: "travel_photo_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["visual_summary", "foreground", "midground", "background", "visible_elements", "dominant_subject", "secondary_subjects", "scene_type", "people_count", "animal_count", "light", "weather", "composition", "technical_quality", "observation_confidence", "uncertainties", "likely_location", "location_confidence", "location_reason", "caption_seed", "editor_note", "needs_fact_check"],
    properties: {
      visual_summary: {type: "string", minLength: 1},
      foreground: {type: "string"},
      midground: {type: "string"},
      background: {type: "string"},
      visible_elements: {
        type: "object", additionalProperties: false,
        required: ["terrain", "vegetation", "water", "snow", "sky", "people", "animals", "structures", "road_vehicle"],
        properties: {
          terrain: {type: "string"}, vegetation: {type: "string"}, water: {type: "string"}, snow: {type: "string"}, sky: {type: "string"}, people: {type: "string"}, animals: {type: "string"}, structures: {type: "string"}, road_vehicle: {type: "string"}
        }
      },
      dominant_subject: {type: "string"},
      secondary_subjects: {type: "array", items: {type: "string"}},
      scene_type: {type: "string", enum: ["portrait", "animal", "meadow", "mountain", "canyon", "lake", "road", "settlement", "interior", "detail", "other"]},
      people_count: {type: "integer", minimum: 0},
      animal_count: {type: "integer", minimum: 0},
      light: {type: "string"},
      weather: {type: "string"},
      composition: {
        type: "object", additionalProperties: false,
        required: ["framing", "depth", "balance", "visual_anchor", "horizon", "distractions"],
        properties: {framing: {type: "string"}, depth: {type: "string"}, balance: {type: "string"}, visual_anchor: {type: "string"}, horizon: {type: "string"}, distractions: {type: "string"}}
      },
      technical_quality: {
        type: "object", additionalProperties: false,
        required: ["sharpness", "exposure", "color", "motion_blur", "score"],
        properties: {sharpness: {type: "string"}, exposure: {type: "string"}, color: {type: "string"}, motion_blur: {type: "string"}, score: {type: "number", minimum: 0, maximum: 10}}
      },
      observation_confidence: {type: "number", minimum: 0, maximum: 1},
      uncertainties: {type: "array", items: {type: "string"}},
      likely_location: {type: "string"},
      location_confidence: {type: "number", minimum: 0, maximum: 1},
      location_reason: {type: "string"},
      caption_seed: {type: "string", minLength: 1},
      editor_note: {type: "string", minLength: 1},
      needs_fact_check: {type: "array", items: {type: "string"}}
    }
  }
};

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

async function analyzePhoto(photo, index, total, context) {
  const prompt = `Проанализируй ОДНУ фотографию для авторского тревел-журнала. Пиши только по-русски.

Сначала выполни чистое визуальное наблюдение без маршрута: передний, средний и задний планы, видимые объекты, люди, животные, свет, погода, композиция и техническое качество.
Только после этого оцени вероятную географию по маршруту: ${JSON.stringify(context?.route || context?.actual_route_order || null)}.

Правила:
- не используй имя файла, Public ID, время и порядок кадров как доказательство содержания;
- обычные горы, луга, юрты, дорога и лошади не доказывают конкретную точку маршрута;
- если уникального ориентира нет, likely_location = «не определена», confidence <= 0.5;
- confidence >= 0.6 допустим только при видимом ориентире, однозначно связанном с одной точкой маршрута;
- неизвестный предмет называй нейтрально, но конкретный предмет можно назвать, если признаки отчётливы;
- не придумывай назначение предметов, занятия людей и культурный смысл;
- caption_seed — короткое буквальное описание кадра;
- editor_note — одно короткое предложение о возможной роли кадра без решения hero/story;
- needs_fact_check содержит только внешний факт для публикации; обычно пустой массив;
- избегай слов «величие», «гармония», «живописный», «идеально передаёт».

Кадр ${index + 1} из ${total}.`;

  const raw = await callStructured({model: visionModel, prompt, schema: photoSchema, image: imageUrl(photo.url), label: `Photo analysis ${photo.public_id}`});
  const textValues = [raw.visual_summary, raw.foreground, raw.midground, raw.background, raw.dominant_subject, raw.light, raw.weather, raw.likely_location, raw.location_reason, raw.caption_seed, raw.editor_note, ...Object.values(raw.visible_elements || {}), ...Object.values(raw.composition || {}), ...Object.values(raw.technical_quality || {}).filter(v => typeof v === "string"), ...(raw.secondary_subjects || []), ...(raw.uncertainties || []), ...(raw.needs_fact_check || [])];
  textValues.forEach((value, i) => assertRussian(value, `Photo ${photo.public_id} text ${i}`));

  return {
    schema_version: schemaVersion,
    analysis_version: analysisVersion,
    cache_key: cacheKey(photo),
    public_id: photo.public_id,
    number: index + 1,
    url: photo.url,
    width: photo.width,
    height: photo.height,
    orientation: photo.height > photo.width ? "vertical" : photo.width > photo.height ? "horizontal" : "square",
    ...raw,
    analysis_source: "combined-vision-with-conservative-geography",
    analyzed_at: new Date().toISOString(),
    model: visionModel
  };
}

function validateRecommendation(raw, items) {
  const ids = items.map(item => item.public_id);
  const decisions = raw?.decisions || {};
  for (const id of ids) {
    if (!decisions[id]) throw new Error(`Series decision missing: ${id}`);
    if (!["hero", "story", "backstage", "skip"].includes(decisions[id].status)) throw new Error(`Invalid status for ${id}`);
    assertRussian(decisions[id].reason, `Series reason ${id}`);
  }
  if (ids.filter(id => decisions[id].status === "hero").length !== 1) throw new Error("Exactly one hero required");
  assertRussian(raw.sequence_note, "Series sequence_note");
  assertRussian(raw.editorial_summary, "Series editorial_summary");
  for (const fact of raw.fact_checks || []) assertRussian(fact, "Series fact_check");
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

async function selectSeries(items, context) {
  const compact = items.map(item => ({
    public_id: item.public_id,
    number: item.number,
    orientation: item.orientation,
    visual_summary: item.visual_summary,
    dominant_subject: item.dominant_subject,
    scene_type: item.scene_type,
    composition: item.composition,
    technical_quality: item.technical_quality,
    likely_location: item.likely_location,
    location_confidence: item.location_confidence,
    caption_seed: item.caption_seed,
    editor_note: item.editor_note
  }));
  const prompt = `Сделай редакторский отбор серии тревел-журнала. Пиши только по-русски.

Правила:
- решение обязательно для каждого public_id;
- ровно 1 hero;
- обычно 6-8 story;
- хорошие повторы и второстепенные кадры — backstage;
- skip только для слабых или худших дублей;
- сравнивай композицию и визуальную функцию, а не соответствие заранее заданной теме;
- финальная сцена автора имеет приоритет только при визуальном подтверждении;
- причины должны быть конкретными;
- fact_checks только для внешних фактов, обычно пустой массив.

Контекст: ${JSON.stringify(context || {})}
Кадры: ${JSON.stringify(compact)}`;
  const raw = await callStructured({model: textModel, prompt, schema: recommendationSchema(items), label: "Series selection"});
  return validateRecommendation(raw, items);
}

const photos = await readJson(inFile);
if (!Array.isArray(photos) || !photos.length) throw new Error(`${inFile} does not contain photos`);
const context = await readJsonIfExists(contextFile);
const previous = await readJsonIfExists(outFile);
const previousByKey = new Map((previous?.items || []).map(item => [item.cache_key, item]));
const items = [];
let reused = 0;
let analyzed = 0;

for (let index = 0; index < photos.length; index++) {
  const photo = photos[index];
  const cached = previousByKey.get(cacheKey(photo));
  if (cached) {
    items.push({...cached, number: index + 1});
    reused++;
    console.log(`Reuse ${index + 1}/${photos.length}: ${photo.public_id}`);
  } else {
    console.log(`Analyze ${index + 1}/${photos.length}: ${photo.public_id}`);
    items.push(await analyzePhoto(photo, index, photos.length, context));
    analyzed++;
  }
}

const recommendation = await selectSeries(items, context);
const result = {
  schema_version: schemaVersion,
  analysis_version: analysisVersion,
  trip,
  day: dayTag,
  photos_source: inFile,
  context_source: context ? contextFile : null,
  generated_at: new Date().toISOString(),
  vision_model: visionModel,
  text_model: textModel,
  cache: {reused, analyzed},
  items,
  recommendation
};

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", {recursive: true});
await fs.writeFile(outFile, JSON.stringify(result, null, 2), "utf8");
console.log(`Saved ${items.length} photos: analyzed ${analyzed}, reused ${reused}`);
