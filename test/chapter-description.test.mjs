import assert from "node:assert/strict";
import test from "node:test";
import { parseChapterDescription } from "../lib/chapter-description.mjs";

test("parses free-form Russian chapter descriptions", () => {
  const chapters = parseChapterDescription(`
Глава 1 — Край земли
Берег, тундра и пейзажи северо-запада Кольского.
Темы: пейзажи, тундра, Баренцево море, Север, побережье
Места: полуостров Немецкий, Титовка

Глава 2 — Под водой Баренцева моря
Погружения в холодном северном море.
Темы: дайвинг, подводный мир, Баренцево море
Места: полуостров Немецкий, Титовка`);

  assert.deepEqual(chapters, [
    { title: "Край земли", description: "Берег, тундра и пейзажи северо-запада Кольского.", themes: "пейзажи, тундра, Баренцево море, Север, побережье", places: "полуостров Немецкий, Титовка" },
    { title: "Под водой Баренцева моря", description: "Погружения в холодном северном море.", themes: "дайвинг, подводный мир, Баренцево море", places: "полуостров Немецкий, Титовка" }
  ]);
});

test("ignores text before the first chapter and supports multiline descriptions", () => {
  assert.deepEqual(parseChapterDescription("Заметка\nГлава 1 - Путь\nПервая строка.\nВторая строка."), [
    { title: "Путь", description: "Первая строка.\nВторая строка.", themes: "", places: "" }
  ]);
});
