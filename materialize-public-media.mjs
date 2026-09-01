import fs from "node:fs/promises";
import path from "node:path";
import { materializePublicPhotos } from "./lib/public-media.mjs";
import { safeSlug } from "./lib/editorial-artifacts.mjs";

const root = process.env.ROOT || ".";
const trip = safeSlug(process.env.TRIP, "trip");
const journal = JSON.parse(await fs.readFile(path.join(root, `data/${trip}/journal.json`), "utf8"));
if (journal.editorial?.status !== "approved") throw new Error(`Trip ${trip} is not approved`);

const photos = [journal.meta?.cover];
for (const chapter of journal.chapters || journal.days || []) {
  photos.push(chapter.hero, ...(chapter.backstage || []));
  for (const scene of chapter.scenes || chapter.story || []) photos.push(...(scene.photos || (scene.photo ? [scene.photo] : [])));
}
const results = await materializePublicPhotos({ root, photos });
const downloaded = results.filter(item => item.status === "downloaded");
console.log(`Materialized ${results.length} photos for ${trip}: ${downloaded.length} downloaded, ${results.length - downloaded.length} already present`);
