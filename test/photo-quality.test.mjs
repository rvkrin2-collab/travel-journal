import assert from "node:assert/strict";
import test from "node:test";
import { hammingDistance, preselectPhotos, qualityScore } from "../lib/photo-quality.mjs";

test("quality score rewards sharp, balanced photos", () => {
  assert.ok(qualityScore({ sharpness: 900, exposure: 0.52, contrast: 0.24 }) > 95);
  assert.ok(qualityScore({ sharpness: 10, exposure: 0.02, contrast: 0.01 }) < 10);
});

test("preselection keeps the strongest photo from a duplicate group", () => {
  const result = preselectPhotos([
    { id: "weak-copy", score: 55, hash: "0000000000000000" },
    { id: "best", score: 88, hash: "0000000000000001" },
    { id: "different", score: 70, hash: "1111111111111111" }
  ], { duplicateDistance: 2 });
  assert.deepEqual(result.selected.map(item => item.id), ["best", "different"]);
  assert.equal(result.rejected[0].duplicateOf, "best");
});

test("hamming distance handles hashes of different lengths", () => {
  assert.equal(hammingDistance("101", "1111"), 2);
});
