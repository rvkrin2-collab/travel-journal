import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = file => fs.readFileSync(file, "utf8");

test("preview bypasses Pages latency for mutable editorial artifacts", () => {
  const html = read("preview.html");
  const loader = read("preview-fresh-data.js");
  assert.match(html, /preview-fresh-data\.js\?v=1/);
  assert.match(loader, /raw\.githubusercontent\.com\/rvkrin2-collab\/travel-journal\/main/);
  assert.match(loader, /author-review\|final-review\|storyboard\|author-feedback\|approval/);
  assert.match(loader, /cache:\s*"no-store"/);
});
