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
            title: { type: "string" }, subtitle: { type: "string" }, one_line: { type: "string" }, intro: { type: "string" }, emotional_curve: { type: "string" }, rhythm: { type: "string" }
          }
        },
        layout_rules: { type: "array", items: { type: "string" } },
        scenes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "place", "title", "text", "text_mode", "photos", "layout", "editorial_note"],
            properties: {
              id: { type: "string", minLength: 1 }, place: { type: "string" }, title: { type: "string" }, text: { type: "string" },
              text_mode: { type: "string", enum: ["short", "quiet", "pause", "main", "final", "hero"] },
              photos: { type: "array", minItems: 1, items: { type: "string", enum: selectedIds } },
              layout: { type: "string", enum: ["single-wide", "wide-pair", "story-pair", "single-quiet", "inside-outside-pair", "transition", "gallery-three", "hero-wide"] },
              editorial_note: { type: "string" }
            }
          }
        },
        backstage_role: { type: "string" }, publication_note: { type: "string" }, fact_checks: { type: "array", items: { type: "string" } }
      }
    }
  };
}

function selectedPhotoIds(authorReview) {
  return (authorReview.items || []).filter(item => item.status === "hero" || item.status === "story").map(item => item.public_id);
}

function assertStoryboardPhotoCoverage(storyboard, selectedIds) {
  const allowed = new Set(selectedIds); const seen = new Set();
  for (const scene of storyboard.scenes || []) {
    if (!Array.isArray(scene.photos) || !scene.photos.length) throw new Error(`Storyboard scene has no photos: ${scene.id || "untitled"}`);
    for (const id of scene.photos) {
      if (!allowed.has(id)) throw new Error(`Storyboard uses a photo not approved for the story: ${id}`);
      if (seen.has(id)) throw new Error(`Storyboard duplicates approved photo: ${id}`);
      seen.add(id);
    }
  }
  const missing = selectedIds.filter(id => !seen.has(id));
  if (missing.length) throw new Error(`Storyboard omitted ${missing.length} approved story photo(s): ${missing.join(", ")}`);
}

async function buildStoryboard(payload, reviewSourceFile, selectedIds) {
  const prompt = `Собери storyboard авторского тревел-журнала. Фотографии — главный рассказ. Текст редкий и только доказуемый.

ИСТОЧНИКИ И ИХ ПРИОРИТЕТ:
1. author_feedback — прямые редакторские указания автора;
2. author_notes и chapter_context — единственный источник авторского смысла, маршрута и формулировок о поездке;
3. утверждённый author_review/final_review — только источник отбора кадров и буквального наблюдаемого содержания.

КРИТИЧЕСКОЕ ПРАВИЛО: НИКОГДА НЕ ПРИДУМЫВАЙ ЗА АВТОРА МЫСЛЬ, ЭМОЦИЮ, МЕТАФОРУ, МОТИВ, ПРИЧИНУ ИЛИ ОБОБЩЕНИЕ.
Не превращай отсутствие фактов в «журнальный» художественный текст. Если в author_notes/context нет мысли, которую можно честно добавить к фотографии, оставь text пустым.

Запрещены любые конструкции вроде:
- «море диктует ритм», «место живёт», «поселения держатся», «лодки ищут защиту», «следы человека», «край света», «здесь время остановилось»;
- предположения о том, зачем люди/объекты находятся в месте и как они живут;
- эмоциональные выводы, которых автор не сообщал;
- выведение истории или характера места из фотографии;
- факты, которые модель знает из общей памяти, но которых нет в проверенных входных данных.

VISUAL LABELS — НЕ ТЕКСТ ДЛЯ ЧИТАТЕЛЯ.
Не копируй label и не перефразируй его. Не перечисляй то, что читатель и так видит. Слова типа «членистоногое», «биота», «донные отложения», «акватория», «низкорослая растительность» относятся к анализу, а не к журнальному тексту.

Текст в сцене допустим ТОЛЬКО если он:
- передаёт буквально данное автором обстоятельство/маршрут, которого не видно на снимке; или
- является коротким переходом между подтверждёнными точками маршрута; или
- сообщает факт, уже явно подтверждённый во входных данных.
Иначе text = "". В большинстве сцен пустой text — нормальный и предпочтительный результат.

Заголовок сцены тоже не обязателен: title = "", если он лишь называет видимый объект («Краб», «Пляж», «Корабль», «Дно» и т. п.).

FACT_CHECKS:
- не заполняй этот массив общеизвестными или придуманными утверждениями;
- не называй неподтверждённое утверждение «подтверждённым»;
- если storyboard не использует внешний факт, верни [].

СТРУКТУРА И МОНТАЖ:
- scenes содержат только hero/story;
- каждый утверждённый hero/story public_id используется ровно один раз;
- backstage/skip не включать;
- близкие по месту и функции кадры можно объединять, если это не ломает маршрут;
- порядок подтверждённых локаций следует chapter_context;
- не назначай конкретную локацию отдельному кадру только по изображению или порядку; если не подтверждено, place = "";
- финальную сцену автора учитывать только если она явно есть в author_notes/context и ей соответствует выбранный кадр;
- сильный кадр может занимать весь визуальный блок без подписи.

СТИЛЬ:
Спокойный, точный, редакторский. Никакой рекламы, пафоса, экскурсионного тона и литературной мишуры. Один блок — одна мысль. Обычно 0–1 короткое предложение. Лучше молчание, чем текст ради текста.

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

const storyboard = await buildStoryboard({ review, final_review: finalReview, author_review: authorReview, author_notes: authorNotes, author_feedback: authorFeedback, chapter_context: chapterContext }, reviewSourceFile, selectedIds);
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