import fs from "fs/promises";
import { assertSamePhotoSet, resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";
import { callStructured } from "./lib/structured-ai.mjs";

const target = resolveEditorialTarget();
const trip = target.trip;
const dayTag = target.chapter;
const finalReviewFile = process.env.FINAL_REVIEW_FILE || `data/${trip}/${dayTag}-final-review.json`;
const authorReviewFile = process.env.AUTHOR_REVIEW_FILE || `data/${trip}/${dayTag}-author-review.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const authorFeedbackFile = process.env.AUTHOR_FEEDBACK_FILE || `data/${trip}/${dayTag}-author-feedback.json`;
const contextFile = process.env.CHAPTER_CONTEXT_FILE || process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-storyboard.json`;

async function readJson(path) { return JSON.parse(await fs.readFile(path, "utf8")); }
async function readJsonIfExists(path) { try { return await readJson(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; } }

function storyboardSchema(selectedIds) {
  return {
    name: "travel_storyboard",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["chapter", "layout_rules", "scenes", "backstage_role", "publication_note", "fact_checks"],
      properties: {
        chapter: {
          type: "object",
          additionalProperties: false,
          required: ["title", "subtitle", "one_line", "intro", "emotional_curve", "rhythm"],
          properties: {
            title: { type: "string" }, subtitle: { type: "string" }, one_line: { type: "string" },
            intro: { type: "string" }, emotional_curve: { type: "string" }, rhythm: { type: "string" }
          }
        },
        layout_rules: { type: "array", items: { type: "string" } },
        scenes: {
          type: "array", minItems: selectedIds.length, maxItems: selectedIds.length,
          items: {
            type: "object", additionalProperties: false,
            required: ["id", "place", "title", "text", "text_mode", "photos", "layout", "editorial_note"],
            properties: {
              id: { type: "string", minLength: 1 }, place: { type: "string" }, title: { type: "string" },
              text: { type: "string", minLength: 1 },
              text_mode: { type: "string", enum: ["short", "quiet", "pause", "main", "final", "hero"] },
              photos: { type: "array", minItems: 1, maxItems: 1, items: { type: "string", enum: selectedIds } },
              layout: { type: "string", enum: ["single-wide", "single-quiet", "hero-wide"] },
              editorial_note: { type: "string" }
            }
          }
        },
        backstage_role: { type: "string" }, publication_note: { type: "string" },
        fact_checks: { type: "array", items: { type: "string" } }
      }
    }
  };
}

function selectedPhotoIds(authorReview) {
  return (authorReview.items || []).filter(item => item.status === "hero" || item.status === "story").map(item => item.public_id);
}

function selectedPhotoRecords(review, selectedIds) {
  const allowed = new Set(selectedIds);
  return (review?.items || []).filter(item => allowed.has(item.public_id)).map(item => ({
    public_id: item.public_id,
    status: item.status,
    label: String(item.label || ""),
    note: String(item.note || "")
  }));
}

function photoSpecificFeedback(authorFeedback, selectedIds) {
  const allowed = new Set(selectedIds);
  return (authorFeedback?.notes || []).filter(note => note?.photo && allowed.has(note.photo)).map(note => ({
    photo: note.photo,
    text: String(note.text || "")
  }));
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

const STOP_WORDS = new Set([
  "и", "а", "но", "или", "в", "во", "на", "с", "со", "к", "ко", "по", "из", "от", "до", "за", "над", "под",
  "при", "у", "о", "об", "для", "между", "через", "среди", "без", "не", "это", "этот", "эта", "эти", "его", "ее",
  "их", "как", "что", "где", "почти", "весь", "вся", "все"
]);

const SENSITIVE_STEMS = [
  "споко", "безве", "ветер", "шторм", "утро", "вечер", "ночь", "полдн", "погод", "туман",
  "жизнь", "живут", "покол", "местн", "рыбац", "турис", "посел", "обита",
  "военн", "забро", "разру", "древн", "старин", "истор", "тради", "назнач",
  "тундр", "аркти", "субар", "северн", "южн", "восточ", "западн",
  "суров", "дикий", "безлю", "опас", "холод", "тепл"
];

function stemToken(token) {
  const value = normalizeText(token);
  if (value.length <= 4) return value;
  return value.slice(0, 5);
}

function contentStems(value) {
  return normalizeText(value).split(" ").filter(Boolean).filter(token => token.length >= 4 && !STOP_WORDS.has(token)).map(stemToken);
}

function isBoilerplateReviewNote(value) {
  const text = normalizeText(value);
  return !text || text === "кадр для основного визуального рассказа" || text === "ключевой визуальный кадр серии" || text.startsWith("дополнительный кадр для блока");
}

function groundingSource(record, feedbackItems) {
  const parts = [record?.label || ""];
  if (record?.note && !isBoilerplateReviewNote(record.note)) parts.push(record.note);
  for (const item of feedbackItems || []) parts.push(item.text || "");
  return parts.filter(Boolean).join(" ");
}

function sensitiveUnsupported(caption, source) {
  const captionText = normalizeText(caption);
  const sourceText = normalizeText(source);
  return SENSITIVE_STEMS.some(stem => captionText.includes(stem) && !sourceText.includes(stem));
}

function unsupportedNumbers(caption, source) {
  const captionNumbers = String(caption || "").match(/\d+(?:[.,]\d+)?/g) || [];
  return captionNumbers.some(number => !String(source || "").includes(number));
}

function unsupportedCapitalizedTerms(caption, source) {
  const sourceText = normalizeText(source);
  const words = String(caption || "").match(/[A-ZА-ЯЁ][A-Za-zА-Яа-яЁё-]{2,}/g) || [];
  return words.slice(1).some(word => !sourceText.includes(normalizeText(word)));
}

function captionIsGrounded(caption, source) {
  if (!String(caption || "").trim() || !String(source || "").trim()) return false;
  if (sensitiveUnsupported(caption, source) || unsupportedNumbers(caption, source) || unsupportedCapitalizedTerms(caption, source)) return false;
  const sourceStems = new Set(contentStems(source));
  const captionStems = contentStems(caption);
  const overlap = captionStems.filter(stem => sourceStems.has(stem)).length;
  return overlap >= Math.min(2, Math.max(1, sourceStems.size));
}

function placeIsGrounded(place, source) {
  const normalizedPlace = normalizeText(place);
  if (!normalizedPlace) return true;
  return normalizeText(source).includes(normalizedPlace);
}

function finishSentence(value) {
  const text = String(value || "").trim().replace(/[.!?]+$/g, "");
  return text ? `${text}.` : "";
}

function safeCaptionFallback(label) {
  return finishSentence(label);
}

function enforcePhotoGrounding(storyboard, records, feedback) {
  const byId = new Map(records.map(record => [record.public_id, record]));
  const feedbackById = new Map();
  for (const item of feedback) {
    if (!feedbackById.has(item.photo)) feedbackById.set(item.photo, []);
    feedbackById.get(item.photo).push(item);
  }

  let captionFallbacks = 0;
  let clearedPlaces = 0;
  for (const scene of storyboard.scenes || []) {
    const id = Array.isArray(scene.photos) ? scene.photos[0] : "";
    const record = byId.get(id);
    if (!record) continue;
    const source = groundingSource(record, feedbackById.get(id) || []);
    if (!captionIsGrounded(scene.text, source)) {
      scene.text = safeCaptionFallback(record.label);
      captionFallbacks += 1;
    } else {
      scene.text = finishSentence(scene.text);
    }
    if (!placeIsGrounded(scene.place, source)) {
      scene.place = "";
      clearedPlaces += 1;
    }
  }
  if (captionFallbacks || clearedPlaces) console.log(`Grounding guard: replaced ${captionFallbacks} caption(s), cleared ${clearedPlaces} unsupported place(s)`);
  return storyboard;
}

function preserveAuthorChapterCopy(storyboard, authorNotes, chapterContext) {
  const description = String(authorNotes?.provided?.description || chapterContext?.author_description || "").trim();
  if (!description) return storyboard;
  storyboard.chapter = storyboard.chapter || {};
  storyboard.chapter.intro = description;
  const firstSentence = description.split(/(?<=[.!?])\s+/)[0]?.trim();
  if (firstSentence) storyboard.chapter.one_line = firstSentence;
  return storyboard;
}

function assertStoryboardPhotoCoverage(storyboard, selectedIds) {
  const scenes = storyboard.scenes || [];
  if (scenes.length !== selectedIds.length) throw new Error(`Storyboard must contain exactly one scene per approved photo: expected ${selectedIds.length}, got ${scenes.length}`);
  const allowed = new Set(selectedIds);
  const seen = new Set();
  for (const scene of scenes) {
    if (!Array.isArray(scene.photos) || scene.photos.length !== 1) throw new Error(`Each storyboard scene must contain exactly one photo: ${scene.id || "untitled"}`);
    if (!String(scene.text || "").trim()) throw new Error(`Each storyboard photo must have its own non-empty caption: ${scene.id || "untitled"}`);
    const id = scene.photos[0];
    if (!allowed.has(id)) throw new Error(`Storyboard uses a photo not approved for the story: ${id}`);
    if (seen.has(id)) throw new Error(`Storyboard duplicates approved photo: ${id}`);
    seen.add(id);
  }
  const missing = selectedIds.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Storyboard omitted ${missing.length} approved story photo(s): ${missing.join(", ")}`);
}

async function buildStoryboard(payload, selectedIds) {
  const prompt = `Собери storyboard авторского тревел-журнала. Фотографии — главный рассказ, но у КАЖДОЙ фотографии должна быть собственная журнальная подпись.

НЕИЗМЕНЯЕМЫЙ КОНТРАКТ ВЁРСТКИ:
- один scene = ровно одна фотография;
- в photos всегда ровно один public_id;
- число scenes равно числу утверждённых hero/story фотографий;
- каждый утверждённый public_id используется ровно один раз;
- никаких пар, коллажей, галерей или групп нескольких фотографий в одной сцене;
- text обязателен и не может быть пустым: это индивидуальная подпись именно к этому кадру;
- hero также является отдельной фотографией с собственной подписью.

ЖЁСТКОЕ ПРАВИЛО ФАКТИЧЕСКОЙ ПРИВЯЗКИ:
- для каждой scene сначала найди запись этого же public_id в selected_photo_records;
- фактическое содержание text и place разрешено брать ТОЛЬКО из label/note этой записи и из photo_specific_feedback для этого же public_id;
- general_author_feedback задаёт стиль и редакторские требования, но НЕ является источником новых фактов о конкретном кадре;
- author_notes и chapter_context разрешены для заголовка главы, вступления, общей последовательности и маршрута главы, но НЕ доказывают, что конкретная фотография снята в конкретной точке маршрута;
- если label конкретного public_id не называет место, а photo_specific_feedback этого public_id его не подтверждает, place оставь пустым;
- route_context никогда не является достаточным основанием заполнить scene.place;
- каждое утверждение в подписи должно быть непосредственно поддержано записью именно этой фотографии.

ПОДПИСИ:
- одно короткое естественное предложение, обычно до 20 слов;
- это журнальная подпись, а не перечень объектов через запятую;
- можно менять синтаксис, порядок слов и использовать нейтральные связующие глаголы, но нельзя добавлять новый факт;
- не добавляй время суток, ветер, историю, назначение, образ жизни, эмоции, мотивы, географию или природные классификации, если их нет у этого же public_id;
- не используй метафоры и олицетворения вместо наблюдения;
- тщательно проверь русскую орфографию и грамматику.

ПЛОХО:
«Безветренное утро дарит чистоту линии горизонта».
«Здесь люди живут между камнем и морем уже много поколений».
«Жизнь на краю концентрируется здесь».
«Тундра начинает отступать к морю».

ГЛАВА:
- intro будет заменён исходным авторским описанием после генерации; не пытайся улучшать его фактами от себя;
- emotional_curve и rhythm описывают только монтаж и последовательность кадров, а не эмоции автора или «характер места»;
- title может быть пустым; place может быть непустым только при подтверждении в данных ТОЙ ЖЕ фотографии.

МОНТАЖ:
- scenes содержат только hero/story;
- соседние кадры могут быть связаны, но НИКОГДА не объединяются в один блок;
- каждый кадр остаётся самостоятельной единицей ритма;
- layout только single-wide, single-quiet или hero-wide.

FACT_CHECKS:
- не выдавай предположение за факт;
- если внешние факты не используются, верни [].

СТИЛЬ:
Спокойный, интеллигентный, точный. Фотожурнал, а не путеводитель. Без рекламы, пафоса, экскурсионного тона, технического жаргона и типичных ИИ-фраз.

APPROVED STORY PUBLIC IDS:
${JSON.stringify(selectedIds, null, 2)}

DATA:
${JSON.stringify(payload, null, 2)}`;

  const response = await callStructured({ prompt, schema: storyboardSchema(selectedIds), label: `Storyboard ${trip}/${dayTag}`, maxTokens: 7000 });
  return response.value;
}

const finalReview = await readJsonIfExists(finalReviewFile);
const authorReview = await readJsonIfExists(authorReviewFile);
if (!authorReview) throw new Error(`${authorReviewFile} is required before storyboard`);
if (authorReview.approval !== "photo_selection_approved" && Number(authorReview.schema_version || 0) >= 2) throw new Error("Author photo selection is not approved");

const inventory = await readJson(process.env.PHOTOS_FILE || target.photos);
const photosFingerprint = assertSamePhotoSet(inventory, authorReview, "author-review");
const review = finalReview || authorReview;
const reviewSourceFile = finalReview ? finalReviewFile : authorReviewFile;
const authorNotes = await readJsonIfExists(authorNotesFile);
const authorFeedback = await readJsonIfExists(authorFeedbackFile);
const chapterContext = await readJsonIfExists(contextFile);
const selectedIds = selectedPhotoIds(authorReview);
if (!selectedIds.length) throw new Error("Author review contains no hero/story photos");
if ((authorReview.items || []).filter(item => item.status === "hero").length !== 1) throw new Error("Author review must contain exactly one hero");

const records = selectedPhotoRecords(review, selectedIds);
const specificFeedback = photoSpecificFeedback(authorFeedback, selectedIds);
let storyboard = await buildStoryboard({
  selected_photo_records: records,
  photo_specific_feedback: specificFeedback,
  general_author_feedback: (authorFeedback?.notes || []).filter(note => !note?.photo),
  author_notes: authorNotes,
  chapter_context: chapterContext
}, selectedIds);
storyboard = enforcePhotoGrounding(storyboard, records, specificFeedback);
storyboard = preserveAuthorChapterCopy(storyboard, authorNotes, chapterContext);

assertStoryboardPhotoCoverage(storyboard, selectedIds);
storyboard.trip = trip;
storyboard.day = dayTag;
storyboard.chapter = storyboard.chapter || {};
storyboard.chapter.title = chapterContext?.chapter_title || authorNotes?.provided?.chapter_title || storyboard.chapter.title || "";
storyboard.chapter_id = dayTag;
storyboard.photos_fingerprint = photosFingerprint;
storyboard.status = "storyboard";
storyboard.final_review_source = reviewSourceFile;
storyboard.author_feedback_source = authorFeedback ? authorFeedbackFile : null;
storyboard.updated_at = new Date().toISOString();
await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await fs.writeFile(outFile, `${JSON.stringify(storyboard, null, 2)}\n`, "utf8");
console.log(`Saved storyboard to ${outFile} from ${reviewSourceFile}${authorFeedback ? ` with ${authorFeedbackFile}` : ""}`);
