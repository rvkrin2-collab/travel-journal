import fs from "fs/promises";
import { createHash } from "node:crypto";
import { inventoryFingerprint, inventoryItems, resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";
import { callStructured, providerSignature } from "./lib/structured-ai.mjs";

const visionModel = providerSignature();
const target = resolveEditorialTarget();
const trip = target.trip;
const chapter = target.chapter;
const inFile = process.env.IN_FILE || target.photos;
const outFile = process.env.OUT_FILE || target.analysis;
const contextFile = process.env.CHAPTER_CONTEXT_FILE || process.env.DAY_CONTEXT_FILE || `data/${trip}/${chapter}-context.json`;
const schemaVersion = 4;
const analysisVersion = "combined-vision-v2";

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

function stableSignature(value) {
  return createHash("sha256").update(JSON.stringify(value || null)).digest("hex");
}

function cacheKey(photo, contextSignature) {
  return [analysisVersion, visionModel, contextSignature, photo.public_id, photo.url, photo.width, photo.height].join("|");
}

function containsLatinText(value) {
  const cleaned = String(value || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\bIMG\d+_[A-Za-z0-9]+\b/g, " ");
  const latinLetters = (cleaned.match(/[A-Za-z]/g) || []).length;
  const cyrillicLetters = (cleaned.match(/[А-Яа-яЁё]/g) || []).length;
  if (latinLetters < 4) return false;
  if (cyrillicLetters === 0) return true;
  return latinLetters > 16 && latinLetters > cyrillicLetters;
}

const speculativeObservationPattern = /\b(скорее всего|предположительно|вероятно|возможно|по[- ]видимому|может быть|напомина\w*|похож\w*)\b/iu;

function textValues(raw) {
  return [raw.observation_label, raw.visual_summary, raw.foreground, raw.midground, raw.background, raw.dominant_subject, raw.light, raw.weather, raw.likely_location, raw.location_reason, raw.caption_seed, raw.editor_note, ...Object.values(raw.visible_elements || {}), ...Object.values(raw.composition || {}), ...Object.values(raw.technical_quality || {}).filter(value => typeof value === "string"), ...(raw.secondary_subjects || []), ...(raw.uncertainties || []), ...(raw.needs_fact_check || [])];
}

function findRussianViolation(raw, photo) {
  const values = textValues(raw);
  const index = values.findIndex(containsLatinText);
  return index === -1 ? null : `Photo ${photo.public_id} text ${index}`;
}

function observationLabelViolation(raw, photo) {
  const value = String(raw.observation_label || "").trim();
  if (!value) return `Photo ${photo.public_id} observation_label is empty`;
  if (speculativeObservationPattern.test(value)) return `Photo ${photo.public_id} observation_label contains speculation`;
  if (/[()]/u.test(value)) return `Photo ${photo.public_id} observation_label contains parenthetical identification`;
  if (/\sили\s/iu.test(value)) return `Photo ${photo.public_id} observation_label contains alternative identification`;
  return "";
}

function neutralObservationLabel(raw) {
  const people = Number(raw.people_count || 0);
  const animals = Number(raw.animal_count || 0);
  const text = `${raw.visual_summary || ""} ${raw.visible_elements?.water || ""}`.toLowerCase();
  const underwater = raw.scene_type === "underwater" || /подвод|толщ[ае] вод|морск(?:ое|ая|ой) дн/u.test(text);

  if (people > 0 && animals > 0) return underwater ? "Люди и животные в подводной среде." : "Люди и животные в окружающем пейзаже.";
  if (people > 0) return underwater ? "Человек в подводной среде." : "Люди в окружающем пейзаже.";
  if (animals > 0) return underwater ? "Морское животное в подводной среде." : "Животное в природной среде.";

  const labels = {
    meadow: "Открытый ландшафт с растительностью.",
    mountain: "Горный ландшафт.",
    canyon: "Скалистый рельеф.",
    lake: "Водоём и окружающий ландшафт.",
    road: "Дорога и окружающий ландшафт.",
    settlement: "Строения и окружающий ландшафт.",
    interior: "Интерьер.",
    detail: "Деталь сцены.",
    underwater: "Подводная сцена.",
    portrait: "Человек в кадре.",
    other: "Сцена с видимыми объектами и окружающей средой."
  };
  return labels[raw.scene_type] || "Сцена с видимыми объектами и окружающей средой.";
}

function assertRussian(raw, photo) {
  const field = findRussianViolation(raw, photo);
  if (field) throw new Error(`${field} must be written in Russian`);
}

const photoSchema = {
  name: "travel_photo_analysis",
  strict: true,
  schema: {
    type: "object", additionalProperties: false,
    required: ["observation_label", "visual_summary", "foreground", "midground", "background", "visible_elements", "dominant_subject", "secondary_subjects", "scene_type", "people_count", "animal_count", "light", "weather", "composition", "technical_quality", "observation_confidence", "uncertainties", "likely_location", "location_confidence", "location_reason", "caption_seed", "editor_note", "needs_fact_check"],
    properties: {
      observation_label: {type: "string", minLength: 1},
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
      scene_type: {type: "string", enum: ["portrait", "animal", "meadow", "mountain", "canyon", "lake", "road", "settlement", "interior", "detail", "underwater", "other"]},
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

async function analyzePhoto(photo, index, total, context, contextSignature) {
  const prompt = `Проанализируй одну фотографию для авторского тревел-журнала. Пиши только по-русски.

Сначала выполни чистое визуальное наблюдение: передний, средний и задний планы, видимые объекты, люди, животные, свет, условия съёмки, композиция и техническое качество.
Авторский контекст дан отдельно ниже. Он НЕ является доказательством того, что видно в кадре, и не должен заставлять тебя подгонять наблюдение под маршрут. Используй его только после визуального наблюдения: для проверки правдоподобия идентификации и для осторожной географической привязки.

Правила чистого наблюдения:
- observation_label — одно короткое буквальное описание только того, что бесспорно видно;
- в observation_label запрещены предположения, скобки, альтернативы через «или», точный вид животного/растения, назначение исторического или технического объекта и название места;
- если точная идентификация неочевидна, используй широкий класс: «морское животное», «водоросли», «металлический объект», «строение», «скалистый берег»;
- точную гипотезу можно записать только в uncertainties или needs_fact_check, но не выдавать её за наблюдение;
- не используй имя файла, Public ID, время и порядок кадров как доказательство содержания;
- неизвестный предмет называй нейтрально;
- не придумывай назначение предметов, занятия людей, культуру и символический смысл;
- caption_seed — короткое буквальное описание кадра без неподтверждённых фактов;
- editor_note — одно короткое предложение о визуальной функции; используй ту же степень точности, что и observation_label;
- needs_fact_check содержит только конкретный внешний факт, который действительно понадобится проверить перед публикацией; если точная идентификация вида/объекта сомнительна и важна для текста, сформулируй её здесь вопросом;
- техническую оценку ставь сравнительно и конкретно, не используй одинаковую оценку автоматически;
- не используй английские фотографические термины: переводи их на русский и не пиши латиницей.

Правила географии:
- обычный пейзаж, животное, водоросли, дорога или строение не доказывают конкретную точку;
- если уникального ориентира нет, likely_location = «не определена», confidence <= 0.5;
- confidence >= 0.6 допустим только при видимом ориентире, однозначно связанном с одной точкой;
- авторский контекст можно использовать для проверки совместимости гипотезы с поездкой, но не как визуальное доказательство;
- если биологическая или предметная идентификация плохо согласуется с авторским контекстом, не утверждай её: используй широкий класс и вынеси гипотезу в needs_fact_check.

АВТОРСКИЙ КОНТЕКСТ:
${JSON.stringify(context || {}, null, 2)}

Кадр ${index + 1} из ${total}.`;

  let response = await callStructured({prompt, schema: photoSchema, image: imageUrl(photo.url), label: `Photo analysis ${photo.public_id}`});
  let raw = response.value;
  const russianViolation = findRussianViolation(raw, photo);
  const observationViolation = observationLabelViolation(raw, photo);

  if (russianViolation || observationViolation) {
    const problem = russianViolation || observationViolation;
    console.warn(`${problem}; retrying once with stricter observation rules`);
    response = await callStructured({
      prompt: `${prompt}\n\nПредыдущий ответ не прошёл локальную проверку: ${problem}.\nПовтори анализ. observation_label должен быть буквальным, нейтральным и широким: никаких «вероятно», «предположительно», «похоже», скобок, альтернатив «или», точного вида организма, назначения объекта или названия места. Все свободные текстовые поля пиши по-русски кириллицей.`,
      schema: photoSchema,
      image: imageUrl(photo.url),
      label: `Photo analysis ${photo.public_id} safe observation retry`
    });
    raw = response.value;
  }

  assertRussian(raw, photo);
  const remainingObservationViolation = observationLabelViolation(raw, photo);
  if (remainingObservationViolation) {
    console.warn(`${remainingObservationViolation}; replacing observation_label with neutral deterministic fallback`);
    raw.observation_label = neutralObservationLabel(raw);
  }

  return {
    schema_version: schemaVersion,
    analysis_version: analysisVersion,
    cache_key: cacheKey(photo, contextSignature),
    public_id: photo.public_id,
    number: index + 1,
    url: photo.url,
    width: photo.width,
    height: photo.height,
    orientation: photo.height > photo.width ? "vertical" : photo.width > photo.height ? "horizontal" : "square",
    ...raw,
    analysis_source: "combined-vision-with-explicit-observation-and-context-separation",
    analyzed_at: new Date().toISOString(),
    ai_provider: response.provider,
    model: response.model
  };
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => run()));
  return results;
}

const inventory = await readJson(inFile);
const photos = inventoryItems(inventory);
if (!Array.isArray(photos) || !photos.length) throw new Error(`${inFile} does not contain photos`);
const photosFingerprint = inventoryFingerprint(inventory);
const context = await readJsonIfExists(contextFile);
const contextSignature = stableSignature(context);
const previous = await readJsonIfExists(outFile);
const previousByKey = new Map((previous?.items || []).map(item => [item.cache_key, item]));
let reused = 0;
let analyzed = 0;
const configuredConcurrency = Number(process.env.PHOTO_ANALYSIS_CONCURRENCY || 3);
const photoConcurrency = Number.isFinite(configuredConcurrency) ? Math.max(1, Math.min(4, Math.floor(configuredConcurrency))) : 3;
console.log(`Photo analysis concurrency: ${photoConcurrency}`);

const items = await mapWithConcurrency(photos, photoConcurrency, async (photo, index) => {
  const key = cacheKey(photo, contextSignature);
  const cached = previousByKey.get(key);
  if (cached) {
    reused++;
    console.log(`Reuse ${index + 1}/${photos.length}: ${photo.public_id}`);
    return {...cached, number: index + 1};
  }
  console.log(`Analyze ${index + 1}/${photos.length}: ${photo.public_id}`);
  const item = await analyzePhoto(photo, index, photos.length, context, contextSignature);
  analyzed++;
  return item;
});

const result = {
  schema_version: schemaVersion,
  analysis_version: analysisVersion,
  trip,
  chapter,
  day: chapter,
  photos_source: inFile,
  photos_fingerprint: photosFingerprint,
  context_source: context ? contextFile : null,
  context_fingerprint: contextSignature,
  generated_at: new Date().toISOString(),
  vision_model: visionModel,
  cache: {reused, analyzed},
  items,
  recommendation: previous?.recommendation || null,
  editorial_policy: previous?.editorial_policy || null
};

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", {recursive: true});
await fs.writeFile(outFile, JSON.stringify(result, null, 2), "utf8");
console.log(`Saved visual analysis for ${items.length} photos: analyzed ${analyzed}, reused ${reused}`);