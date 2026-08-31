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

test("editorial v3 renders the hero as an eager responsive image", () => {
  const script = read("trip-editorial-v3.js");
  const css = read("trip-editorial-v3.css");
  assert.match(script, /appendCoverPhoto/);
  assert.match(script, /eager: true/);
  assert.match(script, /className: "cover__media"/);
  assert.match(css, /\.cover__media\{[^}]*object-fit:cover/);
});

test("legacy Kola trees redirect to the canonical trip", () => {
  const legacyRoots = ["trips/kolskiy-bereg-i-more", "trips/kolskiy-mezhdu-beregom-i-morem"];
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

test("unfinished legacy Kola copy is hidden from the public registry", () => {
  const registry = JSON.parse(read("data/trips.json"));
  assert.equal(registry.trips.find(trip => trip.id === "kolskiy")?.status, "hidden");
});

test("mutable registry and authoring code are refreshed without stale PWA data", () => {
  const worker = read("service-worker.js");
  assert.match(worker, /pathname === "\/data\/trips\.json"[\s\S]*networkFirst\(request\)/);
  assert.match(read("editor.html"), /editor-app\.js\?v=5/);
  assert.match(read("preview.html"), /preview-app\.js\?v=10/);
  assert.match(read("submission.html"), /submission\.js\?v=13/);
  assert.match(worker, /submission\.js\?v=13/);
});

test("every discoverable public page has canonical and social metadata", () => {
  const pages = ["index.html", "trips/kyrgyzstan-2026/index.html", ...Array.from({ length: 8 }, (_, index) => `day${String(index + 1).padStart(2, "0")}.html`)];
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /<meta name="description" content="[^"]+">/, file);
    assert.match(html, /<link rel="canonical" href="https:\/\/owntravel\.ru\/[^"]*">/, file);
    assert.match(html, /<meta property="og:title" content="[^"]+">/, file);
    assert.match(html, /<meta property="og:url" content="https:\/\/owntravel\.ru\/[^"]*">/, file);
  }
});

test("static public photographs are responsive and deferred", () => {
  const pages = ["index.html", "trips/kyrgyzstan-2026/index.html", ...Array.from({ length: 8 }, (_, index) => `day${String(index + 1).padStart(2, "0")}.html`)];
  for (const file of pages) {
    const images = [...read(file).matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
    for (const image of images) {
      assert.match(image, /loading="lazy"/, `${file}: ${image}`);
      assert.match(image, /decoding="async"/, `${file}: ${image}`);
      if (/res\.cloudinary\.com/.test(image)) {
        assert.match(image, /srcset="[^"]+ 480w,[^"]+ 800w,[^"]+ 1200w,[^"]+ 1600w"/, `${file}: ${image}`);
        assert.match(image, /sizes="[^"]+"/, `${file}: ${image}`);
      }
    }
  }
});

test("static public pages preload their CSS hero", () => {
  const pages = ["trips/kyrgyzstan-2026/index.html", ...Array.from({ length: 8 }, (_, index) => `day${String(index + 1).padStart(2, "0")}.html`)];
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /rel="preload" as="image"[^>]+fetchpriority="high"[^>]+data-hero-preload/, file);
    assert.doesNotMatch(html, /background(?:-image)?\s*:[^;{}]*w_(?:2000|2200)\//, file);
  }
});

test("crawler policy exposes only approved canonical content", () => {
  const robots = read("robots.txt");
  assert.match(robots, /Disallow: \/editor\.html/);
  assert.match(robots, /Sitemap: https:\/\/owntravel\.ru\/sitemap\.xml/);
  const sitemap = read("sitemap.xml");
  assert.match(sitemap, /\/trips\/kyrgyzstan-2026\//);
  assert.doesNotMatch(sitemap, /kolskiy/);
  assert.doesNotMatch(sitemap, /editor\.html|preview\.html|author\.html/);
});

test("publisher emits canonical discovery metadata and editorial v3 for future trips", () => {
  const publisher = read("publish-trip.mjs");
  assert.match(publisher, /const publicHead/);
  assert.match(publisher, /rel="canonical"/);
  assert.match(publisher, /\/trips\/\$\{trip\}\/chapters\/\$\{id\}\.html/);
  assert.match(publisher, /trip-editorial-v3\.css/);
  assert.match(publisher, /trip-editorial-v3\.js/);
  assert.match(publisher, /layout_version: 3/);
});
