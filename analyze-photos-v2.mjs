import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_VISION_MODEL || "gpt-4o";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const inFile = process.env.IN_FILE || `data/${trip}/${dayTag}-photos.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-analysis.json`;
const dayContextFile = process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const schemaVersion = 2;

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

function imageUrl(url) {
  return url.replace("/image/upload/", "/image/upload/f_auto,q_auto,w_2200/");
}

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function containsLatinText(value) {
  return /[A-Za-z]{4,}/.test(String(value || ""));
}

function assertRussian(value, field) {
  if (containsLatinText(value)) throw new Error(`${field} must be written in Russian`);
}

async function callStructured({prompt, schema, image, label}) {
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

  if (!response.ok) throw new Error(`${label} error: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const choice = data.choices?.[0];
  console.log(`${label} finish_reason=${choice?.finish_reason || "unknown"}, prompt_tokens=${data.usage?.prompt_tokens || "unknown"}, completion_tokens=${data.usage?.completion_tokens || "unknown"}`);
  if (choice?.finish_reason !== "stop") throw new Error(`${label} incomplete: ${choice?.finish_reason || "unknown"}`);
  if (!choice?.message?.content) throw new Error(`${label} content is empty`);
  return JSON.parse(choice.message.content);
}

const observationSchema = {
  name: "travel_photo_observation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["visual_summary", "foreground", "midground", "background", "visible_elements", "dominant_subject", "secondary_subjects", "scene_type", "people_count", "animal_count", "light", "weather", "composition", "technical_quality", "observation_confidence", "uncertainties"],
    properties: {
      visual_summary: {type: "string", minLength: 1},
      foreground: {type: "string"},
      midground: {type: "string"},
      background: {type: "string"},
      visible_elements: {
        type: "object",
        additionalProperties: false,
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
        type: "object",
        additionalProperties: false,
        required: ["framing", "depth", "balance", "visual_anchor", "horizon", "distractions"],
        properties: {
          framing: {type: "string"}, depth: {type: "string"}, balance: {type: "string"}, visual_anchor: {type: "string"}, horizon: {type: "string"}, distractions: {type: "string"}
        }
      },
      technical_quality: {
        type: "object",
        additionalProperties: false,
        required: ["sharpness", "exposure", "color", "motion_blur", "score"],
        properties: {
          sharpness: {type: "string"}, exposure: {type: "string"}, color: {type: "string"}, motion_blur: {type: "string"}, score: {type: "number", minimum: 0, maximum: 10}
        }
      },
      observation_confidence: {type: "number", minimum: 0, maximum: 1},
      uncertainties: {type: "array", items: {type: "string"}}
    }
  }
};

const geographySchema = {
  name: "travel_photo_geography",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["likely_location", "location_confidence", "location_reason", "caption_seed", "needs_fact_check"],
    properties: {
      likely_location: {type: "string"},
      location_confidence: {type: "number", minimum: 0, maximum: 1},
      location_reason: {type: "string"},
      caption_seed: {type: "string", minLength: 1},
      needs_fact_check: {type: "array", items: {type: "string"}}
    }
  }
};

async function observePhoto(photo, index, total) {
  const prompt = `Ты выполняешь только визуальное наблюдение одной фотографии для авторского тревел-журнала.

Кадр ${index + 1} из ${total}.

ПИШИ ТОЛЬКО ПО-РУССКИ во всех текстовых полях.

КРИТИЧЕСКИЕ ПРАВИЛА:
- Не используй маршрут, время съёмки, имя файла, Public ID и сведения о путешествии.
- Не определяй географию.
- Не решай, брать ли фотографию в рассказ.
- Не используй общие оценки вроде «красивый», «живописный», «величественный», «гармоничный», «безмятежный».
- Сначала разложи изображение на передний, средний и задний планы.
- Укажи конкретные видимые объекты и их положение в кадре.
- Если предмет не удаётся уверенно распознать, назови его нейтрально: «предмет», «оборудование», «неясный объект».
- Не называй неясный предмет стиральной машиной, генератором, инструментом или иной конкретной вещью без явных визуальных признаков.
- Количество людей и животных указывай только настолько точно, насколько позволяет изображение.
- Отделяй наблюдение от сомнений.
- Техническое качество оцени по резкости, экспозиции, цвету и смазу.
- Не ставь одинаковую оценку автоматически: оцени конкретный кадр.

Верни только наблюдение по изображению.`;

  const result = await callStructured({prompt, schema: observationSchema, image: imageUrl(photo.url), label: `Observation ${photo.public_id}`});
  const textValues = [result.visual_summary, result.foreground, result.midground, result.background, result.dominant_subject, result.light, result.weather, ...Object.values(result.visible_elements || {}), ...Object.values(result.composition || {}), ...Object.values(result.technical_quality || {}).filter(value => typeof value === "string"), ...(result.secondary_subjects || []), ...(result.uncertainties || [])];
  textValues.forEach((value, i) => assertRussian(value, `Observation ${photo.public_id} text ${i}`));
  return result;
}

async function inferGeography(photo, observation, context) {
  const prompt = `После завершённого визуального наблюдения оцени вероятную географию кадра.

ПИШИ ТОЛЬКО ПО-РУССКИ во всех текстовых полях.

КРИТИЧЕСКИЕ ПРАВИЛА:
- Используй только наблюдение и маршрут дня.
- Не используй общие знания о том, «как обычно выглядит» место.
- Обычные горы, луга, дорога, юрты или табуны сами по себе НЕ являются уникальным признаком конкретной точки маршрута.
- Если кадр подходит нескольким точкам маршрута или не содержит уникального ориентира, укажи «не определена» и confidence не выше 0.5.
- Confidence 0.6 и выше допустим только при видимом уникальном объекте, который прямо связывает кадр с одной точкой маршрута, например с единственным озером маршрута, если вода действительно видна.
- Не меняй визуальное описание под маршрут.
- caption_seed должен описывать видимое. Название места разрешено только при confidence >= 0.6.
- needs_fact_check включает только внешний факт, который реально понадобится при публикации. Не добавляй проверки видимого, погоды, наличия юрт, лошадей или соответствия фотографии маршруту. Обычно массив пустой.
- Не придумывай историю, традиции, занятия людей и назначение предметов.

DATA:
${JSON.stringify({public_id: photo.public_id, observation, route: context?.route || null}, null, 2)}`;

  const result = await callStructured({prompt, schema: geographySchema, label: `Geography ${photo.public_id}`});
  [result.likely_location, result.location_reason, result.caption_seed, ...(result.needs_fact_check || [])].forEach((value, i) => assertRussian(value, `Geography ${photo.public_id} text ${i}`));
  return result;
}

function recommendationSchema(items) {
  const properties = Object.fromEntries(items.map(item => [item.public_id, {
    type: "object",
    additionalProperties: false,
    required: ["status", "reason", "visual_function", "duplicate_group"],
    properties: {
      status: {type: "string", enum: ["hero", "story", "backstage", "skip"]},
      reason: {type: "string", minLength: 1},
      visual_function: {type: "string", minLength: 1},
      duplicate_group: {type: "string"}
    }
  }]));

  return {
    name: "travel_journal_series_recommendation",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
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

function validateRecommendation(raw, items) {
  const decisions = raw?.decisions || {};
  const expectedIds = items.map(item => item.public_id);
  const statuses = expectedIds.map(id => decisions[id]?.status);

  for (const id of expectedIds) {
    if (!decisions[id]) throw new Error(`Series recommendation missing public_id: ${id}`);
    if (!["hero", "story", "backstage", "skip"].includes(decisions[id].status)) throw new Error(`Invalid series status for ${id}: ${decisions[id].status}`);
    [decisions[id].reason, decisions[id].visual_function, decisions[id].duplicate_group].forEach((value, i) => assertRussian(value, `Series ${id} text ${i}`));
  }

  if (statuses.filter(status => status === "hero").length !== 1) throw new Error("Series recommendation must contain exactly one hero");
  assertRussian(raw.sequence_note, "Series sequence_note");
  assertRussian(raw.editorial_summary, "Series editorial_summary");
  for (const fact of raw.fact_checks || []) assertRussian(fact, "Series fact_check");

  const result = {
    hero: expectedIds.find(id => decisions[id].status === "hero"),
    story: expectedIds.filter(id => decisions[id].status === "story"),
    backstage: expectedIds.filter(id => decisions[id].status === "backstage"),
    skip: expectedIds.filter(id => decisions[id].status === "skip"),
    decisions,
    sequence_note: String(raw.sequence_note || "").trim(),
    editorial_summary: String(raw.editorial_summary || "").trim(),
    fact_checks: Array.isArray(raw.fact_checks) ? raw.fact_checks.map(String).map(value => value.trim()).filter(Boolean) : []
  };

  const classifiedCount = 1 + result.story.length + result.backstage.length + result.skip.length;
  if (classifiedCount !== items.length) throw new Error(`Series recommendation classified ${classifiedCount}/${items.length} photos`);
  return result;
}

async function seriesRecommendation(items, context) {
  const compact = items.map(item => ({
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
    caption_seed: item.caption_seed
  }));

  const prompt = `Ты выпускающий фоторедактор авторского журнала. Все фотографии уже отдельно и подробно проанализированы как изображения.

ПИШИ ТОЛЬКО ПО-РУССКИ во всех текстовых полях.

Сначала сравни кадры между собой, затем сделай редакторский отбор.

Правила:
- прими решение по каждому public_id;
- ровно 1 hero;
- обычно 6-8 story, если материал это оправдывает;
- хорошие, но повторяющиеся или второстепенные кадры отправляй в backstage;
- skip — только технически слабые, действительно лишние или худшие дубли;
- не выбирай hero только потому, что он первый или буквально совпадает с авторской темой;
- оценивай визуальную силу, композицию, разнообразие функций и ритм серии;
- укажи duplicate_group для кадров с одной визуальной функцией;
- не ставь рядом несколько кадров с одинаковой функцией;
- сохраняй порядок реальных локаций только там, где location_confidence >= 0.6; остальные кадры не привязывай к точке маршрута;
- финальная сцена автора имеет высокий приоритет, но должна быть визуально подтверждена;
- причины должны быть конкретными: чем кадр сильнее или слабее его дублей;
- не используй общие формулировки «идеально передаёт», «величие», «гармония», «живописный»;
- fact_checks включают только реальные внешние факты для публикации; не проверяй то, что видно на фотографиях. Обычно массив пустой.

DATA:
${JSON.stringify({context, items: compact}, null, 2)}`;

  const raw = await callStructured({prompt, schema: recommendationSchema(items), label: "Series analysis"});
  return validateRecommendation(raw, items);
}

const photos = await readJson(inFile);
if (!Array.isArray(photos) || !photos.length) throw new Error(`${inFile} does not contain photos`);
const context = await readJsonIfExists(dayContextFile);
const items = [];

for (let index = 0; index < photos.length; index++) {
  const photo = photos[index];
  console.log(`Visual observation ${index + 1}/${photos.length}: ${photo.public_id}`);
  const observation = await observePhoto(photo, index, photos.length);
  const geography = await inferGeography(photo, observation, context);

  items.push({
    schema_version: schemaVersion,
    public_id: photo.public_id,
    number: index + 1,
    url: photo.url,
    width: photo.width,
    height: photo.height,
    orientation: photo.height > photo.width ? "vertical" : photo.width > photo.height ? "horizontal" : "square",
    visual_summary: String(observation.visual_summary || "").trim(),
    foreground: String(observation.foreground || "").trim(),
    midground: String(observation.midground || "").trim(),
    background: String(observation.background || "").trim(),
    visible_elements: observation.visible_elements || {},
    dominant_subject: String(observation.dominant_subject || "").trim(),
    secondary_subjects: Array.isArray(observation.secondary_subjects) ? observation.secondary_subjects.map(String).filter(Boolean) : [],
    scene_type: observation.scene_type || "other",
    people_count: Math.max(0, Number(observation.people_count) || 0),
    animal_count: Math.max(0, Number(observation.animal_count) || 0),
    light: String(observation.light || "").trim(),
    weather: String(observation.weather || "").trim(),
    composition: observation.composition || {},
    technical_quality: {...(observation.technical_quality || {}), score: clamp(observation.technical_quality?.score, 0, 10, 0)},
    likely_location: String(geography.likely_location || "не определена").trim(),
    location_confidence: clamp(geography.location_confidence, 0, 1, 0),
    location_reason: String(geography.location_reason || "").trim(),
    observation_confidence: clamp(observation.observation_confidence, 0, 1, 0),
    uncertainties: Array.isArray(observation.uncertainties) ? observation.uncertainties.map(String).filter(Boolean) : [],
    caption_seed: String(geography.caption_seed || "").trim(),
    needs_fact_check: Array.isArray(geography.needs_fact_check) ? geography.needs_fact_check.map(String).filter(Boolean) : [],
    analysis_source: "vision-v2-separated-observation-geography",
    analyzed_at: new Date().toISOString(),
    model
  });
}

const recommendation = await seriesRecommendation(items, context);
const result = {
  schema_version: schemaVersion,
  trip,
  day: dayTag,
  photos_source: inFile,
  context_source: context ? dayContextFile : null,
  generated_at: new Date().toISOString(),
  model,
  analysis_method: "observation_without_context_then_conservative_geography_then_series_selection",
  items,
  recommendation
};

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", {recursive: true});
await fs.writeFile(outFile, JSON.stringify(result, null, 2), "utf8");
console.log(`Saved conservative Russian visual analysis for ${items.length} photos to ${outFile}`);
