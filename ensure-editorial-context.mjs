import fs from "node:fs/promises";
import { resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";

const target = resolveEditorialTarget();
const tripFile = `data/${target.trip}/trip.json`;
const contextFile = `data/${target.trip}/${target.chapter}-context.json`;
const authorNotesFile = `data/${target.trip}/${target.chapter}-author-notes.json`;

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function exists(path) {
  try { await fs.access(path); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

const trip = await readJson(tripFile);
const chaptersView = (trip.views || []).find(view => ["chapters", "days"].includes(view.id));
const chapter = (chaptersView?.items || []).find(item => item.id === target.chapter);
if (!chapter) throw new Error(`Chapter ${target.chapter} not found in ${tripFile}`);

if (!(await exists(contextFile))) {
  const context = {
    schema_version: 1,
    trip: target.trip,
    chapter: target.chapter,
    source: "trip_json",
    chapter_title: String(chapter.title || "").trim(),
    author_description: String(chapter.description || "").trim(),
    route: [],
    actual_route_order: []
  };
  await fs.writeFile(contextFile, `${JSON.stringify(context, null, 2)}\n`, "utf8");
  console.log(`Created editorial context: ${contextFile}`);
} else {
  console.log(`Editorial context already exists: ${contextFile}`);
}

if (!(await exists(authorNotesFile))) {
  const notes = {
    schema_version: 1,
    trip: target.trip,
    chapter: target.chapter,
    source: "pending_author_input",
    chapter_title: String(chapter.title || "").trim(),
    author_description: String(chapter.description || "").trim(),
    main_impression: "",
    central_thought: "",
    required_moments: [],
    final_emotion: "",
    final_scene: "",
    actual_route: []
  };
  await fs.writeFile(authorNotesFile, `${JSON.stringify(notes, null, 2)}\n`, "utf8");
  console.log(`Created author notes placeholder: ${authorNotesFile}`);
} else {
  console.log(`Author notes already exist: ${authorNotesFile}`);
}
