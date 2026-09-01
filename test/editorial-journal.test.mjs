import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("approved Kola trip exposes its selected photos and cover", async () => {
  const [journal, trip, registry] = await Promise.all([
    fs.readFile("data/kolskiy-u-vody-i-pod-vodoy/journal.json", "utf8").then(JSON.parse),
    fs.readFile("data/kolskiy-u-vody-i-pod-vodoy/trip.json", "utf8").then(JSON.parse),
    fs.readFile("data/trips.json", "utf8").then(JSON.parse)
  ]);
  assert.equal(journal.editorial.status, "approved");
  assert.equal(journal.editorial.approved_by_author, true);
  assert.ok(journal.chapters.every(chapter => chapter.hero && chapter.scenes.length > 0));
  assert.deepEqual(trip.photo_manifest, []);
  assert.equal(registry.trips.find(item => item.id === journal.meta.id).cover_url, `https://api.owntravel.ru/thumbnail/${journal.meta.cover.key}?w=1600`);
  assert.equal(registry.trips.find(item => item.id === journal.meta.id).status, "completed");
});

test("Kola chapter inventories preserve the submitted R2 photo sets", async () => {
  const expected = new Map([
    ["kray-zemli", 14],
    ["pod-vodoy-barentseva-morya", 12],
    ["teriberka", 15]
  ]);
  for (const [chapter, count] of expected) {
    const inventory = JSON.parse(await fs.readFile(`data/kolskiy-u-vody-i-pod-vodoy/${chapter}-photos.json`, "utf8"));
    assert.equal(inventory.chapter, chapter);
    assert.equal(inventory.source, "google_photos_r2");
    assert.equal(inventory.photo_count, count);
    assert.equal(inventory.items.length, count);
    assert.equal(new Set(inventory.items.map(item => item.photo_id)).size, count);
    assert.ok(inventory.items.every(item => item.url.startsWith(`https://photos.owntravel.ru/kolskiy-u-vody-i-pod-vodoy/${chapter}/`)));
    assert.match(inventory.photos_fingerprint, /^[a-f0-9]{64}$/);
  }
});

test("published journal pages use chapters, navigation, and public metadata", async () => {
  const [index, day, script] = await Promise.all([
    fs.readFile("trips/kolskiy-u-vody-i-pod-vodoy/index.html", "utf8"),
    fs.readFile("trips/kolskiy-u-vody-i-pod-vodoy/chapters/teriberka.html", "utf8"),
    fs.readFile("trip-editorial-v3.js", "utf8")
  ]);
  assert.doesNotMatch(index, /noindex,nofollow/);
  assert.match(index, /rel="canonical" href="https:\/\/owntravel\.ru\/trips\/kolskiy-u-vody-i-pod-vodoy\/"/);
  assert.match(day, /data-chapter="teriberka"/);
  assert.match(script, /previous|index - 1|Все главы/);
  assert.doesNotMatch(index + day, /photos\.owntravel\.ru/);
});
