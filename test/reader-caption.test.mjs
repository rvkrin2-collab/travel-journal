import assert from "node:assert/strict";
import test from "node:test";
import { readerCaptionSeed, readsLikeEditorialNote, safeReaderCaption } from "../lib/reader-caption.mjs";

test("keeps the grounded photo-specific caption seed", () => {
  assert.equal(readerCaptionSeed({ caption_seed: "Каменный берег обрамляет спокойную воду" }), "Каменный берег обрамляет спокойную воду.");
});

test("rejects production language from reader captions", () => {
  assert.equal(readsLikeEditorialNote("Этот кадр нужен здесь как переход к финалу."), true);
  assert.equal(safeReaderCaption({ generated: "Кульминационный кадр серии.", note: "У воды стоят лодки и деревянный причал", label: "Лодки у причала" }), "У воды стоят лодки и деревянный причал.");
});

test("does not carry inferred geography or atmosphere into the author caption", () => {
  const observed = { caption_seed: "Суровый арктический берег Кольского полуострова.", observation_label: "Каменистый берег у воды" };
  assert.equal(readerCaptionSeed(observed, observed.observation_label), "Каменистый берег у воды.");
});
