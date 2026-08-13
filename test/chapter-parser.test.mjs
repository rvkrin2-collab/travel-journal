import assert from "node:assert/strict";
import test from "node:test";
import { parseChapters } from "../lib/chapter-parser.mjs";

test("parses pasted Russian chapters into author fields", () => {
  const chapters = parseChapters(`
**Глава 1 — Край земли**
Берег, тундра и пейзажи.
Темы: \`пейзажи, тундра, Баренцево море\`
Места: \`полуостров Немецкий, Титовка\`

Глава 2 — Териберка
Один день на другом берегу.
Темы: Териберка, побережье
Места: Териберка
`);
  assert.deepEqual(chapters, [
    { title: "Край земли", description: "Берег, тундра и пейзажи.", themes: "пейзажи, тундра, Баренцево море", places: "полуостров Немецкий, Титовка" },
    { title: "Териберка", description: "Один день на другом берегу.", themes: "Териберка, побережье", places: "Териберка" }
  ]);
});
