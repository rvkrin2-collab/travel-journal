import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("preview exposes a real feedback action", () => {
  const html = read("preview.html");
  const app = read("preview-app.js");
  const picker = read("google-photos-picker.js");
  assert.match(html, /id="sendNoteBtn"/);
  assert.match(html, /Отправить замечание/);
  assert.match(app, /submitPreviewFeedback/);
  assert.match(app, /preview_feedback/);
  assert.match(picker, /\/preview-feedback/);
});

test("worker dispatches preview feedback separately from approval", () => {
  const worker = read("worker/src/index.js");
  assert.match(worker, /preview_feedback_submitted/);
  assert.match(worker, /url\.pathname === "\/preview-feedback"/);
  assert.match(worker, /Invalid preview feedback/);
});

test("author feedback rebuilds storyboard and enforces one photo with one caption", () => {
  const workflow = read(".github/workflows/build-storyboard.yml");
  const builder = read("build-storyboard.mjs");
  assert.match(workflow, /\*-author-feedback\.json/);
  assert.match(builder, /author-feedback\.json/);
  assert.match(builder, /author_feedback/);
  assert.match(builder, /один scene = ровно одна фотография/);
  assert.match(builder, /text обязателен и не может быть пустым/);
  assert.match(builder, /никаких пар, коллажей, галерей или групп/);
  assert.match(builder, /scene\.photos\.length !== 1/);
  assert.match(builder, /Each storyboard photo must have its own non-empty caption/);
});

test("preview renders every approved photo as its own figure with an individual caption", () => {
  const app = read("preview-app.js");
  assert.match(app, /scene\.photos\.length !== 1/);
  assert.match(app, /у фотографии нет индивидуальной подписи/);
  assert.match(app, /<figure class="scene-photo">/);
  assert.match(app, /<figcaption class="scene-caption">/);
  assert.match(app, /scenes\.length !== approvedStory\.size/);
  assert.match(app, /Каждая фотография показана отдельно со своей подписью/);
});
