import fs from "node:fs/promises";
import path from "node:path";

const root = process.env.ROOT || ".";
const tripId = process.env.TRIP;
if (!tripId || !/^[a-z0-9-]+$/.test(tripId)) throw new Error("TRIP must be a stable slug");

const readJson = async relative => JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
const readText = relative => fs.readFile(path.join(root, relative), "utf8");
const fail = message => { throw new Error(`Published trip validation failed: ${message}`); };

const [registry, trip, journal, tripPage] = await Promise.all([
  readJson("data/trips.json"),
  readJson(`data/${tripId}/trip.json`),
  readJson(`data/${tripId}/journal.json`),
  readText(`trips/${tripId}/index.html`)
]);

const registryTrip = (registry.trips || []).find(item => item.id === tripId);
if (!registryTrip) fail("trip is missing from data/trips.json");
if (registryTrip.status !== "completed") fail(`registry status is ${registryTrip.status || "missing"}, expected completed`);
if (!registryTrip.cover_url) fail("registry cover_url is empty");
if (trip.editorial_status !== "published") fail(`trip editorial_status is ${trip.editorial_status || "missing"}, expected published`);
if (journal?.editorial?.status !== "approved") fail(`journal editorial status is ${journal?.editorial?.status || "missing"}, expected approved`);
if (!Array.isArray(journal.chapters) || !journal.chapters.length) fail("journal has no chapters");
if (/noindex\s*,\s*nofollow/i.test(tripPage)) fail("public trip page still contains noindex,nofollow");

for (const chapter of journal.chapters) {
  const chapterId = chapter?.id;
  if (!chapterId || !/^[a-z0-9-]+$/.test(chapterId)) fail("journal contains an invalid chapter id");
  const page = await readText(`trips/${tripId}/chapters/${chapterId}.html`);
  if (!page.includes(`data-chapter="${chapterId}"`)) fail(`chapter page ${chapterId} does not identify itself`);
  if (/noindex\s*,\s*nofollow/i.test(page)) fail(`chapter page ${chapterId} still contains noindex,nofollow`);
}

console.log(`Validated published trip ${tripId}: ${journal.chapters.length} chapter(s), registry, journal and public pages are consistent`);
