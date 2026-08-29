import fs from "node:fs/promises";

const trip = process.env.TRIP || process.argv[2];
if (!trip) throw new Error("TRIP is required");

const tripFile = `data/${trip}/trip.json`;

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function exists(path) {
  try { await fs.access(path); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

const tripData = await readJson(tripFile);
const chapterView = (tripData.views || []).find(view => ["chapters", "days"].includes(view.id));
const chapters = chapterView?.items || [];
if (!chapters.length) throw new Error(`${tripFile} contains no chapters`);

for (const chapter of chapters) {
  const id = String(chapter.id || "").trim();
  if (!id) continue;
  const title = String(chapter.title || "").trim();
  const description = String(chapter.description || "").trim();
  const contextFile = `data/${trip}/${id}-context.json`;
  const notesFile = `data/${trip}/${id}-author-notes.json`;

  if (!(await exists(contextFile))) {
    const context = {
      schema_version: 1,
      trip,
      chapter: id,
      source: "author_submission",
      chapter_title: title,
      author_description: description
    };
    await fs.writeFile(contextFile, `${JSON.stringify(context, null, 2)}\n`, "utf8");
    console.log(`Created author context: ${contextFile}`);
  }

  if (!(await exists(notesFile))) {
    const notes = {
      schema_version: 1,
      trip,
      chapter: id,
      source: "author_submission",
      provided: {
        chapter_title: title,
        description
      }
    };
    await fs.writeFile(notesFile, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
    console.log(`Created author notes: ${notesFile}`);
  }
}
