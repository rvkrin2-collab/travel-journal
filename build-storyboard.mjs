import fs from "fs/promises";
import { assertSamePhotoSet, resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";
import { callStructured } from "./lib/structured-ai.mjs";

const target = resolveEditorialTarget();
const trip = target.trip;
const dayTag = target.chapter;
const finalReviewFile = process.env.FINAL_REVIEW_FILE || `data/${trip}/${dayTag}-final-review.json`;
const authorReviewFile = process.env.AUTHOR_REVIEW_FILE || `data/${trip}/${dayTag}-author-review.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const contextFile = process.env.CHAPTER_CONTEXT_FILE || process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-storyboard.json`;

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try { return await readJson(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

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
            title: { type: "string" },
            subtitle: { type: "string" },
            one_line: { type: "string" },
            intro: { type: "string" },
            emotional_curve: { type: "string" },
            rhythm: { type: "string" }
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
              id: { type: "string", minLength: 1 },
              place: { type: "string" },
              title: { type: "string" },
              text: { type: "string" },
              text_mode: { type: "string", enum: ["short", "quiet", "pause", "main", "final", "hero"] },
              photos: { type: "array", minItems: 1, items: { type: "string", enum: selectedIds } },
              layout: { type: "string", enum: ["single-wide", "wide-pair", "story-pair", "single-quiet", "inside-outside-pair", "transition", "gallery-three", "hero-wide"] },
              editorial_note: { type: "string" }
            }
          }
        },
        backstage_role: { type: "string" },
        publication_note: { type: "string" },
        fact_checks: { type: "array", items: { type: "string" } }
      }
    }
  };
}

function selectedPhotoIds(authorReview) {
  return (authorReview.items || [])
    .filter(item => item.status === "hero" || item.status === "story")
    .map(item => item.public_id);
}

function assertStoryboardPhotoCoverage(storyboard, selectedIds) {
  const allowed = new Set(selectedIds);
  const seen = new Set();
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
  const prompt = `Собери storyboard для авторского тревел-журнала.

Главный принцип: сначала фотографии и реальное содержание, затем история, затем текст. Географию нельзя ломать ради визуального сходства.

ИСТОЧНИКИ, КОТОРЫЕ РАЗРЕШЕНО ИСПОЛЬЗОВАТЬ:
- утверждённый автором review;
- author_notes;
- chapter_context;
- визуальные подписи и заметки внутри review.
Не добавляй исторические, географические, биологические или иные факты, которых нет в этих источниках. Если формулировка требует внешней проверки, не утверждай её как факт: добавь короткий пункт в fact_checks. Если информации мало, оставь текст коротким и наблюдательным.

Жёсткие правила:
- Используй в scenes только кадры со статусом hero или story.
- Каждый утверждённый hero/story public_id должен встретиться в scenes ровно один раз. Ничего не пропускай и не дублируй.
- backstage и skip в scenes не включай.
- Сначала сопоставь кадры с реальной локацией и моментом маршрута. Если локация кадра не подтверждена, не придумывай её: place может быть нейтральным.
- Не смешивай разные места в одном блоке только из-за похожего цвета, формы или настроения.
- Порядок подтверждённых локаций должен следовать маршруту из chapter_context, если он задан.
- Финальную сцену из авторских заметок используй с высоким приоритетом, но только если выбранные фотографии ей соответствуют.

Иерархия решений:
1. Реальное содержание фотографии и подтверждённая локация.
2. Авторский маршрут.
3. Авторская идея и эмоциональная кривая.
4. Сила фотографии.
5. Ритм публикации.

Собери сцены, а не подписи к каждому кадру. У каждой сцены: title, text, text_mode, photos, layout, editorial_note. Один визуальный блок — одна мысль. Обычно текст 1–3 предложения. Не пересказывай очевидное на снимке.

Тон: спокойный, точный, журнальный. Без рекламы, пафоса и типичных ИИ-фраз. Запрещены обороты: «захватывающие виды», «жемчужина», «словами не передать», «незабываемый», «обязательно стоит», «живописный уголок», «величие природы».

APPROVED STORY PUBLIC IDS:
${JSON.stringify(selectedIds, null, 2)}

DATA:
${JSON.stringify(payload, null, 2)}`;

  const response = await callStructured({
    prompt,
    schema: storyboardSchema(selectedIds),
    label: `Storyboard ${trip}/${dayTag}`,
    maxTokens: 7000
  });
  return response.value;
}

const finalReview = await readJsonIfExists(finalReviewFile);
const authorReview = await readJsonIfExists(authorReviewFile);
if (!authorReview) throw new Error(`${authorReviewFile} is required before storyboard`);
if (authorReview.approval !== "photo_selection_approved" && Number(authorReview.schema_version || 0) >= 2) {
  throw new Error("Author photo selection is not approved");
}

const inventory = await readJson(process.env.PHOTOS_FILE || target.photos);
const photosFingerprint = assertSamePhotoSet(inventory, authorReview, "author-review");
const review = finalReview || authorReview;
const reviewSourceFile = finalReview ? finalReviewFile : authorReviewFile;
const authorNotes = await readJsonIfExists(authorNotesFile);
const chapterContext = await readJsonIfExists(contextFile);
const selectedIds = selectedPhotoIds(authorReview);
if (!selectedIds.length) throw new Error("Author review contains no hero/story photos");
if ((authorReview.items || []).filter(item => item.status === "hero").length !== 1) throw new Error("Author review must contain exactly one hero");

const storyboard = await buildStoryboard({
  review,
  final_review: finalReview,
  author_review: authorReview,
  author_notes: authorNotes,
  chapter_context: chapterContext
}, reviewSourceFile, selectedIds);

assertStoryboardPhotoCoverage(storyboard, selectedIds);
storyboard.trip = trip;
storyboard.day = dayTag;
storyboard.chapter = storyboard.chapter || {};
storyboard.chapter.title = chapterContext?.chapter_title || authorNotes?.provided?.chapter_title || storyboard.chapter.title || "";
storyboard.chapter_id = dayTag;
storyboard.photos_fingerprint = photosFingerprint;
storyboard.status = "storyboard";
storyboard.final_review_source = reviewSourceFile;
storyboard.updated_at = new Date().toISOString();
await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await fs.writeFile(outFile, `${JSON.stringify(storyboard, null, 2)}\n`, "utf8");
console.log(`Saved storyboard to ${outFile} from ${reviewSourceFile}`);
