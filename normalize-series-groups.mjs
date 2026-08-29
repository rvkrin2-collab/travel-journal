import fs from "node:fs/promises";
import { resolveEditorialTarget } from "./lib/editorial-artifacts.mjs";

const target = resolveEditorialTarget();
const analysisFile = process.env.ANALYSIS_FILE || target.analysis;
const analysis = JSON.parse(await fs.readFile(analysisFile, "utf8"));
const recommendation = analysis.recommendation;
if (!recommendation?.decisions) throw new Error("analysis recommendation is missing");

const itemsById = new Map((analysis.items || []).map(item => [String(item.public_id || item.photo_id || ""), item]));
let changed = 0;

for (const [id, decision] of Object.entries(recommendation.decisions)) {
  const item = itemsById.get(id);
  if (!item) continue;
  const underwater = item.scene_type === "underwater" || /подвод/u.test(String(item.visual_summary || "").toLowerCase());
  if (!underwater) continue;

  const group = String(decision.duplicate_group || "").trim();
  if (group) {
    const separator = " · ";
    const suffix = group.includes(separator) ? group.split(separator).slice(1).join(separator) : group;
    const normalized = `под водой${suffix ? `${separator}${suffix}` : ""}`;
    if (normalized !== group) {
      decision.duplicate_group = normalized;
      changed += 1;
    }
  }

  if (typeof decision.reason === "string") {
    decision.reason = decision.reason.replace(/озеро\s*·/giu, "под водой ·");
  }
}

// Фактологические вопросы принадлежат анализу отдельных кадров и этапу текста,
// а не редакторскому ранжированию серии.
recommendation.fact_checks = [];

await fs.writeFile(analysisFile, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
console.log(`Normalized underwater duplicate groups: ${changed}`);
