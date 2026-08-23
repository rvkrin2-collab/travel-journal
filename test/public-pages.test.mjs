import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const walk = directory => fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);

test("published editorial pages use responsive R2 thumbnails", () => {
  const script = read("trip-editorial.js");
  assert.match(script, /\.srcset = \[480, 800, 1200, 1600\]/);
  assert.match(script, /image\.sizes = sizes/);
  assert.doesNotMatch(script, /el\("img", \{ src: photoUrl\(day\.hero/);
});

test("published editorial layout cannot overflow horizontally", () => {
  const css = read("trip-editorial.css");
  assert.match(css, /html\{[^}]*overflow-x:hidden/);
  assert.match(css, /body\{[^}]*overflow-x:hidden/);
});

test("legacy Kola trees redirect to the canonical trip", () => {
  const legacyRoots = ["trips/kolskiy-bereg-i-more", "trips/kolskiy-mezhdu-beregom-i-morem", "trips/kolskiy-u-vody-i-pod-vodoy"];
  for (const directory of legacyRoots) {
    for (const file of walk(directory).filter(value => value.endsWith(".html"))) {
      const html = read(file);
      assert.match(html, /name="robots" content="noindex,nofollow"/, file);
      assert.match(html, /src="\/legacy-trip-redirect\.js"/, file);
    }
  }
});

test("legacy day editor points to the canonical editor", () => {
  const html = read("editor-day02.html");
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /editor\.html\?trip=kyrgyzstan-2026&amp;chapter=day02/);
});

test("preview supports legacy storyboards linked through author_review_source", () => {
  const script = read("preview-app.js");
  assert.match(script, /storyboard\.author_review_source/);
});

test("unfinished Kola publication is hidden from the public registry", () => {
  const registry = JSON.parse(read("data/trips.json"));
  assert.equal(registry.trips.find(trip => trip.id === "kolskiy")?.status, "hidden");
});
