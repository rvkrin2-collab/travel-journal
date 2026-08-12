import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("author page cache-busts the picker modules and PWA precaches those URLs", async () => {
  const [html, author, worker] = await Promise.all([
    fs.readFile("author.html", "utf8"),
    fs.readFile("author.js", "utf8"),
    fs.readFile("service-worker.js", "utf8")
  ]);

  assert.match(html, /src="author\.js\?v=19\.1"/);
  assert.match(author, /from "\.\/google-photos-picker\.js\?v=19\.1"/);
  assert.match(worker, /"\/author\.js\?v=19\.1"/);
  assert.match(worker, /"\/google-photos-picker\.js\?v=19\.1"/);
});
