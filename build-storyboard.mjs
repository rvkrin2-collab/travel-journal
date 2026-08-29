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
          minItems: selectedIds.length,
          maxItems: selectedIds.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "place", "title", "text", "text_mode", "photos", "layout", "editorial_note"],
            properties: {
              id: { type: "string", minLength: 1 },
              place: { type: "string" },
              title: { type: "string" },
              text: { type: "string", minLength: 1 },
              text_mode: { type: "string", enum: ["short", "quiet", "pause", "main", "final", "hero"] },
              photos: {
                type: "array",
                minItems: 1,
                maxItems: 1,
                items: { type: "string", enum: selectedIds }
              },
              layout: { type: "string", enum: ["single-wide", "single-quiet", "hero-wide"] },
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
  const scenes = storyboard.scenes || [];
  if (scenes.length !== selectedIds.length) {
    throw new Error(`Storyboard must contain exactly one scene per approved photo: expected ${selectedIds.length}, got ${scenes.length}`);
  }

  const allowed = new Set(selectedIds);
  const seen = new Set();
  for (const scene of scenes) {
    if (!Array.isArray(scene.photos) || scene.photos.length !== 1) {
      throw new Error(`Each storyboard scene must contain exactly one photo: ${scene.id || "untitled"}`);
    }
    if (!String(scene.text || "").trim()) {
      throw new Error(`Each storyboard photo must have its own non-empty caption: ${scene.id || "untitled"}`);
    }
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

ИСТОЧНИКИ И ИХ ПРИОРИТЕТ:
1. author_feedback — прямые редакторские указания автора;
2. author_notes и chapter_context — источник авторского смысла, маршрута и известных обстоятельств поездки;
3. утверждённый author_review/final_review — источник отбора кадров и наблюдаемого содержания.

КАК ПИСАТЬ ПОДПИСИ:
- подпись — 1 короткое, естественное журнальное предложение, обычно до 20 слов;
- она должна читаться как подпись в хорошем фотожурнале, а не как отчёт компьютерного зрения;
- не перечисляй все объекты в кадре и не начинай с канцелярского «на фотографии изображено»;
- если у автора есть контекст или факт — добавь его к конкретному кадру;
- если дополнительного контекста нет, допустима спокойная человеческая фиксация конкретной сцены, которую действительно видно, без технических терминов и без домыслов;
- не копируй visual label дословно; используй его только как проверку того, что реально присутствует в кадре;
- конкретное название места допускается только когда оно подтверждено author_notes/chapter_context или утверждёнными данными;
- при неопределённости используй нейтральную формулировку, а не догадку.

ПЛОХО:
«Морское членистоногое находится на каменистом субстрате среди донной растительности».
«Скалистый берег с низкорослой растительностью и водной акваторией».
«Море диктует здесь ритм жизни».

ХОРОШИЙ ПРИНЦИП:
коротко назвать конкретный момент или добавить подтверждённый контекст, не объясняя читателю то, что он и так видит, и не сочиняя смысл за автора.

ЗАПРЕЩЕНО ПРИДУМЫВАТЬ:
- мысли, эмоции, метафоры, мотивы и причины за автора;
- образ жизни людей по одному кадру;
- назначение объектов, если оно не подтверждено;
- историю, географию и природные факты из общей памяти модели;
- конструкции вроде «море диктует ритм», «место живёт», «край света», «время остановилось», «следы человека».

ЗАГОЛОВКИ:
- title может быть пустым; не дублируй в нём подпись;
- place может быть пустым, если точная локация конкретного кадра не подтверждена.

МОНТАЖ:
- scenes содержат только hero/story;
- сохраняй реальный маршрут из chapter_context/author_notes;
- соседние кадры могут быть смыслово связаны, но НИКОГДА не объединяются в один блок;
- каждый кадр остаётся самостоятельной единицей ритма;
- layout только single-wide, single-quiet или hero-wide.

FACT_CHECKS:
- не выдавай предположение за факт;
- добавляй сюда только утверждения, которые реально требуют отдельной проверки перед публикацией;
- если внешние факты не используются, верни [].

СТИЛЬ:
Спокойный, интеллигентный, точный. National Geographic / Sidetracked / Cereal как ориентир по лаконичности, но без подражания конкретным текстам. Без рекламы, пафоса, экскурсионного тона и технического жаргона.

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
const authorFeedback = await readJsonIfExists(authorFeedbackFile);
const chapterContext = await readJsonIfExists(contextFile);
const selectedIds = selectedPhotoIds(authorReview);
if (!selectedIds.length) throw new Error("Author review contains no hero/story photos");
if ((authorReview.items || []).filter(item => item.status === "hero").length !== 1) {
  throw new Error("Author review must contain exactly one hero");
}

const storyboard = await buildStoryboard({
  review,
  final_review: finalReview,
  author_review: authorReview,
  author_notes: authorNotes,
  author_feedback: authorFeedback,
  chapter_context: chapterContext
}, selectedIds);

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
