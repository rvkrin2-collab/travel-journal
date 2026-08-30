import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/process-trip-request.yml", import.meta.url), "utf8");
const analyzer = fs.readFileSync(new URL("../analyze-photos-only-v3.mjs", import.meta.url), "utf8");

test("trip processing runs independent chapters with bounded concurrency", () => {
  assert.match(workflow, /CHAPTER_CONCURRENCY: 2/);
  assert.match(workflow, /xargs -r -P "\$\{CHAPTER_CONCURRENCY:-2\}"/);
  assert.match(workflow, /process_chapter\(\)/);
  assert.match(workflow, /TRIP="\$trip" CHAPTER="\$chapter" node analyze-photos-only-v3\.mjs/);
});

test("photo analysis runs independent frames concurrently but preserves result order", () => {
  assert.match(analyzer, /async function mapWithConcurrency/);
  assert.match(analyzer, /PHOTO_ANALYSIS_CONCURRENCY \|\| 3/);
  assert.match(analyzer, /Math\.min\(4, Math\.floor\(configuredConcurrency\)\)/);
  assert.match(analyzer, /results\[index\] = await worker\(values\[index\], index\)/);
  assert.match(analyzer, /const items = await mapWithConcurrency\(photos, photoConcurrency/);
});

test("series analysis still follows visual analysis inside every chapter", () => {
  const visual = workflow.indexOf('node analyze-photos-only-v3.mjs');
  const series = workflow.indexOf('node build-series-v2.mjs');
  const review = workflow.indexOf('node build-review-v2.mjs');
  assert.ok(visual > 0 && series > visual && review > series);
});
