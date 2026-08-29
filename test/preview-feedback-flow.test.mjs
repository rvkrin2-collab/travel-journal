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

test("author feedback rebuilds storyboard and is included in the prompt", () => {
  const workflow = read(".github/workflows/build-storyboard.yml");
  const builder = read("build-storyboard.mjs");
  assert.match(workflow, /\*-author-feedback\.json/);
  assert.match(builder, /author-feedback\.json/);
  assert.match(builder, /author_feedback/);
  assert.match(builder, /Лучше пустой текст, чем слабый/);
  assert.match(builder, /label\/описание кадра из review НЕ является готовой подписью/);
});

test("preview can render a scene without redundant prose", () => {
  const app = read("preview-app.js");
  assert.match(app, /const copy = title \|\| text \?/);
});
