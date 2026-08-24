import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("author page cache-busts the picker modules and PWA precaches those URLs", async () => {
  const [html, author, worker, workflow] = await Promise.all([
    fs.readFile("author.html", "utf8"),
    fs.readFile("author.js", "utf8"),
    fs.readFile("service-worker.js", "utf8"),
    fs.readFile(".github/workflows/process-trip-request.yml", "utf8")
  ]);

  assert.match(html, /href="author\.css\?v=25"/);
  assert.match(html, /src="author\.js\?v=25"/);
  assert.match(html, /id="show-google-user-id"[^>]*disabled/);
  assert.doesNotMatch(html, /id="show-google-user-id"[^>]*hidden/);
  assert.match(author, /google-photos-picker\.js\?v=25/);
  assert.match(author, /photo-services-config\.mjs\?v=25/);
  assert.match(author, /showGoogleUserId\.disabled = false/);
  assert.match(author, /photoPicker\.submit\(data\)/);
  assert.match(author, /googlePhotosButton\.disabled = !photoPicker/);
  assert.match(author, /parseChapters\(/);
  assert.match(html, /Отправить и запустить обработку/);
  assert.match(html, /Вставить все главы одним текстом/);
  assert.match(worker, /submission\.html/);
  assert.match(workflow, /repository_dispatch:/);
  assert.match(workflow, /author_trip_submitted/);
  assert.match(workflow, /Analyze every submitted chapter/);
  for (const asset of ["author.css", "author.js", "google-photos-picker.js", "lib/photo-services-config.mjs"]) {
    assert.match(worker, new RegExp(`${asset.replaceAll(".", "\\.")}\\?v=25`));
  }
});
