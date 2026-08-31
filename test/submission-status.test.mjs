import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { chapterStatus, overallProgress, overallStateLabel } from "../lib/submission-status.mjs";

const fingerprint = "photos-v1";
const artifact = extra => ({ photos_fingerprint: fingerprint, updated_at: "2026-08-27T10:00:00.000Z", ...extra });

test("recent automatic processing is shown as active", () => {
  const status = chapterStatus({ photos: artifact({ generated_at: "2026-08-27T10:00:00.000Z" }) }, Date.parse("2026-08-27T10:10:00.000Z"));
  assert.equal(status.kind, "working");
  assert.equal(status.percent, 17);
  assert.equal(status.nextIndex, 1);
  assert.equal(status.label, "Анализируем фотографии");
});

test("old inventory without analysis is reported as stalled", () => {
  const status = chapterStatus({ photos: artifact({ generated_at: "2026-08-13T19:33:08.801Z", updated_at: undefined }) }, Date.parse("2026-08-27T10:00:00.000Z"));
  assert.equal(status.kind, "stalled");
  assert.equal(status.action, "restart");
  assert.match(status.instruction, /повторного запуска/);
});

test("author selection and preview approval produce explicit actions", () => {
  const select = chapterStatus({ photos: artifact(), analysis: artifact(), ai: artifact() });
  assert.equal(select.kind, "action");
  assert.equal(select.action, "editor");
  assert.equal(select.label, "Нужно утвердить фотографии");
  const preview = chapterStatus({ photos: artifact(), analysis: artifact(), ai: artifact(), author: artifact(), storyboard: artifact() });
  assert.equal(preview.kind, "action");
  assert.equal(preview.action, "preview");
  assert.equal(preview.label, "Нужно утвердить preview");
});

test("overall progress counts every chapter stage and publication", () => {
  const complete = chapterStatus({ photos: artifact(), analysis: artifact(), ai: artifact(), author: artifact(), storyboard: artifact(), approval: artifact({ status: "preview_approved" }) });
  assert.deepEqual(overallProgress([complete], false), { percent: 86, done: 6, total: 7 });
  assert.deepEqual(overallProgress([complete], true), { percent: 100, done: 7, total: 7 });
});

test("fully approved chapters are described as ready for publication", () => {
  const complete = chapterStatus({ photos: artifact(), analysis: artifact(), ai: artifact(), author: artifact(), storyboard: artifact(), approval: artifact({ status: "preview_approved" }) });
  assert.equal(overallStateLabel([complete], false), "Готово к публикации");
  assert.equal(overallStateLabel([complete], true), "Опубликовано");
});

test("submission page offers one trip-wide retry with a local result", () => {
  const script = fs.readFileSync(new URL("../submission.js", import.meta.url), "utf8");
  assert.match(script, /Перезапустить обработку путешествия/);
  assert.match(script, /id="retry-result"/);
  assert.match(script, /Причина остановки/);
  assert.match(script, /processing-status\.json/);
  assert.doesNotMatch(script, /if \(value\.status\.action === "restart"\)/);
});

test("publication status remains visible until the public registry changes", () => {
  const script = fs.readFileSync(new URL("../submission.js", import.meta.url), "utf8");
  assert.match(script, /travel-journal-publication-/);
  assert.match(script, /Команда отправлена/);
  assert.match(script, /Проверяем результат автоматически/);
  assert.match(script, /Открыть опубликованное путешествие/);
});
