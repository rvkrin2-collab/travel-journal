import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("unapproved Kola draft exposes no photos or cover", async () => {
  const [journal, trip, registry] = await Promise.all([
    fs.readFile("data/kolskiy-u-vody-i-pod-vodoy/journal.json", "utf8").then(JSON.parse),
    fs.readFile("data/kolskiy-u-vody-i-pod-vodoy/trip.json", "utf8").then(JSON.parse),
    fs.readFile("data/trips.json", "utf8").then(JSON.parse)
  ]);
  assert.equal(journal.editorial.status, "awaiting_visual_review");
  assert.equal(journal.editorial.approved_by_author, false);
  assert.ok(journal.days.every(day => !day.hero && day.story.length === 0 && day.backstage.length === 0));
  assert.deepEqual(trip.photo_manifest, []);
  assert.equal(registry.trips.find(item => item.id === journal.meta.id).cover_url, "");
  assert.equal(registry.trips.find(item => item.id === journal.meta.id).status, "hidden");
});

test("journal pages use days, navigation, and noindex draft protection", async () => {
  const [index, day, script] = await Promise.all([
    fs.readFile("trips/kolskiy-u-vody-i-pod-vodoy/index.html", "utf8"),
    fs.readFile("trips/kolskiy-u-vody-i-pod-vodoy/days/teriberka.html", "utf8"),
    fs.readFile("trip-editorial.js", "utf8")
  ]);
  assert.match(index, /noindex,nofollow/);
  assert.match(day, /data-day="teriberka"/);
  assert.match(script, /previous|index - 1|Всё путешествие/);
  assert.doesNotMatch(index + day, /photos\.owntravel\.ru/);
});
