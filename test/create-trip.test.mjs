import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTrip, createTripFromRequest, validateTripId } from "../create-trip.mjs";

test("trip id accepts stable slugs and rejects paths", () => {
  assert.equal(validateTripId("georgia-2027"), "georgia-2027");
  assert.throws(() => validateTripId("../Georgia"), /--id/);
});

test("createTripFromRequest consumes a mobile author request", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "travel-request-"));
  await fs.mkdir(path.join(directory, "data"));
  await fs.writeFile(path.join(directory, "data/trips.json"), JSON.stringify({ trips: [] }));
  const requestPath = path.join(directory, "request.json");
  await fs.writeFile(requestPath, JSON.stringify({ type: "new_trip_request", trip: { id: "georgia-2027", title: "Грузия" }, chapters: [{ title: "Тбилиси", themes: ["Города"], places: ["Тбилиси"], photos: [{ name: "one.jpg" }] }] }));
  await createTripFromRequest(requestPath, directory);
  const data = JSON.parse(await fs.readFile(path.join(directory, "data/georgia-2027/trip.json")));
  assert.equal(data.views[0].items[0].title, "Тбилиси");
  assert.equal(data.views[1].items[0].title, "Города");
  assert.equal(data.photo_manifest[0].name, "one.jpg");
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
