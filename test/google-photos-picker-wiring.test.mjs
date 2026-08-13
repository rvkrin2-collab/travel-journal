import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("author page cache-busts the picker modules and PWA precaches those URLs", async () => {
  const [html, author, worker] = await Promise.all([
    fs.readFile("author.html", "utf8"),
    fs.readFile("author.js", "utf8"),
    fs.readFile("service-worker.js", "utf8")
  ]);

  assert.match(html, /href="author\.css\?v=19\.1"/);
  assert.match(html, /src="author\.js\?v=19\.1"/);
  assert.match(author, /google-photos-picker\.js\?v=19\.1/);
  assert.match(author, /photo-services-config\.mjs\?v=19\.1/);
  for (const asset of ["author.css", "author.js", "google-photos-picker.js", "lib/photo-services-config.mjs"]) {
    assert.match(worker, new RegExp(`${asset.replaceAll(".", "\\.")}\\?v=19\\.1`));
  }
});
