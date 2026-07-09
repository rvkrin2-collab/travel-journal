import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const finalReviewFile = process.env.FINAL_REVIEW_FILE || `data/${trip}/${dayTag}-final-review.json`;
const authorReviewFile = process.env.AUTHOR_REVIEW_FILE || `data/${trip}/${dayTag}-author-review.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-storyboard.json`;

if (!apiKey) throw new Error("OPENAI_API_KEY secret is missing");

function normalizeDay(value) {
  const raw = String(value || "").trim().toLowerCase();
  const number = raw.match(/\d+/);
  if (number) return `day${String(Number(number[0])).padStart(2, "0")}`;
  return raw.replace(/[^a-z0-9-]/g, "") || "day01";
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try { return await readJson(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw error;
  }
}

async function buildStoryboard(payload, reviewSourceFile) {
  const prompt = `Собери storyboard для авторского тревел-журнала.

Главный принцип: финальная вёрстка строит визуальный рассказ, но не ломает географию дня.

Жёсткое правило перед сборкой:
- Сначала сопоставь каждый выбранный кадр с реальной локацией и моментом маршрута.
- Не смешивай разные места в одном блоке только из-за похожего цвета, формы или настроения.
- Если две локации похожи визуально, держи их отдельно и в порядке маршрута.
- Если локация кадра сомнительна, не используй его как ключевой переход и отметь сомнение в editorial_note.

Иерархия решений:
1. Реальное содержание фотографии и её локация.
2. Авторский маршрут дня.
3. Авторская идея и эмоциональная кривая.
4. Сила фотографии.
5. Ритм финальной публикации.
6. Технический порядок кадров в author-review.

Что нужно сделать:
- Разложить материал на сцены, а не на отдельные подписи к фото.
- У каждой сцены: title, text, text_mode, photos, layout, editorial_note.
- text — короткая фраза или абзац между фотографиями. Не объясняй очевидное на снимке.
- Используй только public_id из review.
- Порядок сцен может отличаться от порядка карточек только внутри одной подтверждённой локации. Порядок локаций должен следовать маршруту дня.
- Горизонтальные фотографии обычно ставь широкими блоками.
- Вертикальные фотографии используй точечно: как паузу или пару, если они усиливают сцену.
- Не ставь подряд много похожих пейзажей. Один сильный кадр лучше трёх повторов.
- Человеческие сцены ставь там, где они меняют смысл, а не просто как иллюстрацию.
- За кадром оставляй хорошие, но необязательные фотографии.

Тон текста:
- спокойный;
- точный;
- журнальный;
- без рекламных слов;
- без банальных ИИ-фраз.

Запрещённые обороты: «захватывающие виды», «жемчужина», «словами не передать», «незабываемый», «обязательно стоит», «живописный уголок», «величие природы».

Верни только JSON:
{
  "trip":"${trip}",
  "day":"${dayTag}",
  "status":"storyboard",
  "updated_at":"ISO_DATE",
  "final_review_source":"${reviewSourceFile}",
  "chapter":{
    "title":"...",
    "subtitle":"...",
    "one_line":"...",
    "intro":"...",
    "emotional_curve":"...",
    "rhythm":"..."
  },
  "layout_rules":["..."],
  "scenes":[
    {"id":"...","place":"...","title":"...","text":"...","text_mode":"short|quiet|pause|main|final|hero","photos":["public_id"],"layout":"single-wide|wide-pair|story-pair|single-quiet|inside-outside-pair|transition|gallery-three|hero-wide","editorial_note":"..."}
  ],
  "backstage_role":"...",
  "publication_note":"..."
}

DATA:
${JSON.stringify(payload, null, 2)}`;

  const headers = {"Content-Type": "application/json"};
  headers["Author" + "ization"] = `Bearer ${apiKey}`;
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify({model, temperature: 0.1, response_format: {type: "json_object"}, messages: [{role: "user", content: prompt}]})
  });
  if (!response.ok) throw new Error(`OpenAI storyboard error: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return extractJson(data.choices?.[0]?.message?.content || "");
}

const finalReview = await readJsonIfExists(finalReviewFile);
const authorReview = await readJsonIfExists(authorReviewFile);
const review = finalReview || authorReview;
const reviewSourceFile = finalReview ? finalReviewFile : authorReviewFile;
if (!review) throw new Error(`${finalReviewFile} or ${authorReviewFile} is required to build storyboard`);
let authorNotes = null;
try { authorNotes = await readJson(authorNotesFile); } catch (error) {}
const storyboard = await buildStoryboard({review, final_review: finalReview, author_review: authorReview, author_notes: authorNotes}, reviewSourceFile);
storyboard.trip = trip;
storyboard.day = dayTag;
storyboard.status = "storyboard";
storyboard.final_review_source = reviewSourceFile;
storyboard.updated_at = new Date().toISOString();
await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", {recursive: true});
await fs.writeFile(outFile, JSON.stringify(storyboard, null, 2), "utf8");
console.log(`Saved storyboard to ${outFile} from ${reviewSourceFile}`);
