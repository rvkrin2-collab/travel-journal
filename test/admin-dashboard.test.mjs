import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("administrative dashboard is private from crawlers and reachable from author flows", () => {
  const html = read("admin.html");
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /id="drafts"/);
  assert.match(html, /id="published"/);
  assert.match(html, /id="archive"/);
  assert.match(html, /admin\.js\?v=1/);
  assert.match(read("author.html"), /href="admin\.html">Мои путешествия/);
  assert.match(read("submission.html"), /href="admin\.html">Все путешествия/);
  assert.match(read("robots.txt"), /Disallow: \/admin\.html/);
  assert.match(read("service-worker.js"), /\|admin\|draft/);
});

test("admin manifest contains registered trips and data-only legacy drafts", () => {
  const manifest = JSON.parse(read("data/admin-trips.json"));
  const registry = JSON.parse(read("data/trips.json"));
  const dataTrips = fs.readdirSync(path.join(root, "data"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, "data", entry.name, "trip.json")))
    .map(entry => entry.name);
  const expected = new Set([...registry.trips.map(trip => trip.id), ...dataTrips]);
  assert.deepEqual(new Set(manifest.trips.map(trip => trip.id)), expected);
  assert.equal(manifest.trips.find(trip => trip.id === "kolskiy-u-vody-i-pod-vodoy")?.archived, false);
  assert.equal(manifest.trips.find(trip => trip.id === "kolskiy-bereg-i-more")?.archived, true);
});

test("admin dashboard offers the next editorial action without bypassing approval", () => {
  const script = read("admin.js");
  assert.match(script, /editor\.html\?trip=\$\{trip\.id\}&chapter=\$\{action\.chapter\.id\}/);
  assert.match(script, /preview\.html\?trip=\$\{trip\.id\}&chapter=\$\{action\.chapter\.id\}/);
  assert.match(script, /submission\.html\?trip=\$\{trip\.id\}/);
  assert.doesNotMatch(script, /publishTrip|\/publish/);
  assert.match(script, /identify\(\)/);
});
