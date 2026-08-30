import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

test("editor uses chapter artifacts and blocks incomplete export", async () => {
  const [html, app] = await Promise.all([fs.readFile("editor.html", "utf8"), fs.readFile("editor-app.js", "utf8")]);
  assert.match(html, /editor-app\.js/);
  assert.match(app, /params\.get\("chapter"\)/);
  assert.match(app, /analysis.*ai-review/s);
  assert.match(app, /apply\(aiReview\)/);
  assert.match(app, /cache:\s*"no-store"/);
  assert.match(app, /ровно одно главное фото/);
  assert.match(app, /Выберите решение для каждого кадра/);
  assert.match(app, /photos_fingerprint/);
  assert.match(app, /approvePhotos\(review\)/);
  assert.match(app, /Открыть оригинал/);
  assert.match(app, /\/thumbnail\//);
  assert.match(app, /decoding = "async"/);
  assert.doesNotMatch(html, /\.thumb\{[^}]*background:#171714/);
  assert.match(html, /object-fit:contain;background:var\(--paper2\)/);
});

test("preview requires author review, complete storyboard and revision-bound approval", async () => {
  const [html, app, validator, workflow] = await Promise.all([
    fs.readFile("preview.html", "utf8"),
    fs.readFile("preview-app.js", "utf8"),
    fs.readFile("validate-editorial-chapter.mjs", "utf8"),
    fs.readFile(".github/workflows/process-editorial-approval.yml", "utf8")
  ]);
  assert.match(html, /preview-app\.js/);
  assert.match(app, /-author-review\.json/);
  assert.match(app, /-storyboard\.json/);
  assert.doesNotMatch(app, /-ai-review\.json|`\$\{base\}-review\.json`/);
  assert.match(app, /photo_selection_approved/);
  assert.match(app, /preview_approved/);
  assert.match(app, /storyboard_updated_at:\s*currentStoryboard\?\.updated_at/);
  assert.match(app, /author_review_updated_at:\s*currentAuthor\?\.updated_at/);
  assert.match(app, /storyboard пропустил утверждённый кадр/);
  assert.match(app, /approvePreview\(approval\)/);
  assert.match(app, /\/thumbnail\//);
  assert.match(validator, /approval\.storyboard_updated_at === storyboard\?\.updated_at/);
  assert.match(validator, /approval\.author_review_updated_at === \(author\?\.updated_at \|\| ""\)/);
  assert.match(workflow, /Reject stale preview approval/);
});

test("new workflows no longer invoke Cloudinary", async () => {
  const packageJson = await fs.readFile("package.json", "utf8");
  const workflows = await fs.readdir(".github/workflows");
  assert.doesNotMatch(packageJson, /sync-cloudinary/);
  assert.ok(!workflows.some(name => name.includes("cloudinary")));
});
