import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTrip, createTripFromRequest, validatePhotoSourceUrl, validateTripId } from "../create-trip.mjs";

test("trip id accepts stable slugs and rejects paths", () => {
  assert.equal(validateTripId("georgia-2027"), "georgia-2027");
  assert.throws(() => validateTripId("../Georgia"), /--id/);
});

test("photo source only accepts HTTPS Google Photos links", () => {
  assert.equal(validatePhotoSourceUrl("https://photos.app.goo.gl/example"), "https://photos.app.goo.gl/example");
  assert.equal(validatePhotoSourceUrl("[https://photos.app.goo.gl/example](https://photos.app.goo.gl/example)"), "https://photos.app.goo.gl/example");
  assert.throws(() => validatePhotoSourceUrl("http://photos.app.goo.gl/example"), /Google Фото/);
  assert.throws(() => validatePhotoSourceUrl("https://example.com/album"), /Google Фото/);
});

test("createTripFromRequest consumes a mobile author request", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "travel-request-"));
  await fs.mkdir(path.join(directory, "data"));
  await fs.writeFile(path.join(directory, "data/trips.json"), JSON.stringify({ trips: [] }));
  const requestPath = path.join(directory, "request.json");
  await fs.writeFile(requestPath, JSON.stringify({ type: "new_trip_request", trip: { id: "georgia-2027", title: "Грузия", cover_source_chapter_id: "tbilisi" }, chapters: [{ id: "tbilisi", title: "Тбилиси", themes: ["Города"], places: ["Тбилиси"], photo_source_url: "https://photos.app.goo.gl/example", photos: [{ name: "one.jpg" }] }] }));
  await createTripFromRequest(requestPath, directory);
  const data = JSON.parse(await fs.readFile(path.join(directory, "data/georgia-2027/trip.json")));
  assert.equal(data.views[0].items[0].title, "Тбилиси");
  assert.equal(data.views[1].items[0].title, "Города");
  assert.equal(data.views[1].items[0].id, "theme-goroda");
  assert.equal(data.photo_manifest[0].name, "one.jpg");
  assert.equal(data.photo_sources[0].url, "https://photos.app.goo.gl/example");
  assert.equal(data.cover_selection.chapter_id, "tbilisi");
  assert.equal(data.views[0].items[0].href, "chapters/tbilisi.html");
  assert.match(await fs.readFile(path.join(directory, "trips/georgia-2027/chapters/tbilisi.html"), "utf8"), /Открыть альбом Google Фото/);
  assert.equal(data.views[0].items[0].photo_source_url, "https://photos.app.goo.gl/example");
  const registry = JSON.parse(await fs.readFile(path.join(directory, "data/trips.json")));
  assert.equal(registry.trips[0].status, "hidden");
  await createTripFromRequest(requestPath, directory);
  const registryAfterRepeat = JSON.parse(await fs.readFile(path.join(directory, "data/trips.json")));
  assert.equal(registryAfterRepeat.trips.length, 1);
});

test("createTrip registers and scaffolds a trip", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "travel-trip-"));
  await fs.mkdir(path.join(directory, "data"));
  await fs.writeFile(path.join(directory, "data/trips.json"), JSON.stringify({ current_trip: "old", trips: [] }));
  await createTrip({ id: "georgia-2027", title: "Грузия 2027" }, directory);
  const registry = JSON.parse(await fs.readFile(path.join(directory, "data/trips.json")));
  const data = JSON.parse(await fs.readFile(path.join(directory, "data/georgia-2027/trip.json")));
  assert.equal(registry.trips[0].public_path, "trips/georgia-2027/");
  assert.deepEqual(data.views.map(view => view.id), ["chapters", "themes", "places"]);
  assert.match(await fs.readFile(path.join(directory, "trips/georgia-2027/index.html"), "utf8"), /Грузия 2027/);
});
