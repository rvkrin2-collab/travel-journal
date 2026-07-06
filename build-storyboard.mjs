import fs from "fs/promises";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const finalReviewFile = process.env.FINAL_REVIEW_FILE || `data/${trip}/${dayTag}-final-review.json`;
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

function extractJson(text) {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch (error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw error;
  }
}

async function buildStoryboard(payload) {
  const prompt = `Собери storyboard для авторского тревел-журнала.

Главный принцип: финальная вёрстка не повторяет механический порядок карточек. Она строит визуальный рассказ.

Иерархия решений:
1. Авторская идея и маршрут дня.
2. Сила фотографии.
3. Ритм финальной публикации.
4. Технический порядок кадров в author-review.

Что нужно сделать:
- Разложить материал на сцены, а не на отдельные подписи к фото.
- У каждой сцены: title, text, text_mode, photos, layout, editorial_note.
- text — короткая фраза или абзац между фотографиями. Не объясняй очевидное на снимке.
- Используй только public_id из final_review.
- Порядок сцен может отличаться от порядка карточек, если так история становится сильнее.
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
  "final_review_source":"${finalReviewFile}",
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
    {"id":"...","title":"...","text":"...","text_mode":"short|quiet|pause|main|final","photos":["public_id"],"layout":"single-wide|wide-pair|story-pair|single-quiet|inside-outside-pair|transition","editorial_note":"..."}
  ],
  "backstage_role":"...",
  "publication_note":"..."
}

DATA:
${JSON.stringify(payload, null, 2)}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {"Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json"},
    body: JSON.stringify({model, temperature: 0.15, response_format: {type: "json_object"}, messages: [{role: "user", content: prompt}]})
  });
  if (!response.ok) throw new Error(`OpenAI storyboard error: ${response.status} ${await response.text()}`);
  const data = await response.json();
  return extractJson(data.choices?.[0]?.message?.content || "");
}

const finalReview = await readJson(finalReviewFile);
let authorNotes = null;
try { authorNotes = await readJson(authorNotesFile); } catch (error) {}
const storyboard = await buildStoryboard({final_review: finalReview, author_notes: authorNotes});
storyboard.trip = trip;
storyboard.day = dayTag;
storyboard.status = "storyboard";
storyboard.final_review_source = finalReviewFile;
storyboard.updated_at = new Date().toISOString();
await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", {recursive: true});
await fs.writeFile(outFile, JSON.stringify(storyboard, null, 2), "utf8");
console.log(`Saved storyboard to ${outFile}`);
