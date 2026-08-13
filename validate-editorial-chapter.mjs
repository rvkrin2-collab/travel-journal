import fs from "node:fs/promises";
import { assertSamePhotoSet, inventoryFingerprint, inventoryItems, resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";

const target = resolveEditorialTarget();
const read = async file => JSON.parse(await fs.readFile(file, "utf8"));
const optional = async file => fs.readFile(file, "utf8").then(JSON.parse).catch(error => error.code === "ENOENT" ? null : Promise.reject(error));
const inventory = await read(process.env.PHOTOS_FILE || target.photos);
const photos = inventoryItems(inventory);
if (!photos.length) throw new Error(`${target.photos} contains no photos`);
const fingerprint = inventoryFingerprint(inventory);
for (const [label, file] of [["analysis", target.analysis], ["ai-review", target.aiReview], ["author-review", target.authorReview], ["final-review", target.finalReview]]) {
  const artifact = await optional(file); if (artifact) assertSamePhotoSet(inventory, artifact, label);
}
const author = await optional(target.authorReview);
if (author) {
  const statuses = author.items.map(item => item.status);
  if (statuses.some(status => !["hero", "story", "backstage", "skip"].includes(status))) throw new Error("author-review contains an unresolved photo status");
  if (statuses.filter(status => status === "hero").length !== 1) throw new Error("author-review must contain exactly one hero");
}
const storyboard = await optional(target.storyboard);
if (storyboard) {
  const authorApproved = author && (author.approval === "photo_selection_approved" || (!author.schema_version && author.status === "author_review"));
  if (!authorApproved) throw new Error("storyboard exists without approved author-review");
  if (storyboard.photos_fingerprint && storyboard.photos_fingerprint !== fingerprint) throw new Error("storyboard uses a stale photos fingerprint");
}
const approval = await optional(target.approval);
if (approval && (approval.status !== "preview_approved" || approval.photos_fingerprint !== fingerprint || !storyboard)) throw new Error("preview approval is invalid or stale");
console.log(`${target.trip}/${target.chapter}: ${photos.length} photos, fingerprint ${fingerprint}`);
