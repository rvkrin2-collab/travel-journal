import assert from "node:assert/strict";
import test from "node:test";
import { assertSamePhotoSet, createPhotoInventory, resolveChapter, resolveEditorialTarget } from "../lib/editorial-artifacts.mjs";

const photos = [
  { key: "trip/chapter/a.jpg", url: "https://photos.owntravel.ru/trip/chapter/a.jpg", name: "a.jpg" },
  { key: "trip/chapter/b.jpg", url: "https://photos.owntravel.ru/trip/chapter/b.jpg", name: "b.jpg" }
];

test("arbitrary chapter slugs and legacy day values resolve without collision", () => {
  assert.equal(resolveChapter("teriberka"), "teriberka");
  assert.equal(resolveChapter("day-2"), "day02");
  assert.equal(resolveEditorialTarget({ TRIP: "kola", CHAPTER: "under-water" }).photos, "data/kola/under-water-photos.json");
});

test("R2 inventory has a stable fingerprint and exact-set validation", () => {
  const inventory = createPhotoInventory({ trip: "trip", chapter: "chapter", photos });
  assert.equal(inventory.photo_count, 2);
  assert.match(inventory.photos_fingerprint, /^[a-f0-9]{64}$/);
  const artifact = { photos_fingerprint: inventory.photos_fingerprint, items: inventory.items.map(photo => ({ photo_id: photo.photo_id })) };
  assert.equal(assertSamePhotoSet(inventory, artifact, "analysis"), inventory.photos_fingerprint);
  assert.throws(() => assertSamePhotoSet(inventory, { items: artifact.items.slice(1) }, "analysis"), /exact photo inventory/);
});
