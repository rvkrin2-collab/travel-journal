import fs from "fs/promises";

export async function loadEditorialPolicy({trip, dayTag}) {
  const base = JSON.parse(await fs.readFile("config/editorial-policy.json", "utf8"));
  const candidates = [
    `data/${trip}/editorial-policy.json`,
    `data/${trip}/${dayTag}-editorial-policy.json`
  ];

  let result = base;
  for (const path of candidates) {
    try {
      const override = JSON.parse(await fs.readFile(path, "utf8"));
      result = deepMerge(result, override);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return result;
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (!base || typeof base !== "object") return override;
  if (!override || typeof override !== "object") return override ?? base;
  const result = {...base};
  for (const [key, value] of Object.entries(override)) {
    result[key] = key in result ? deepMerge(result[key], value) : value;
  }
  return result;
}

export function policyPrompt(policy) {
  const selection = policy.selection || {};
  const language = policy.language || {};
  const overrides = selection.max_story_per_duplicate_group_overrides || {};
  return `
ОБЩАЯ РЕДАКЦИОННАЯ ПОЛИТИКА ПРОЕКТА:
- hero: ровно ${selection.hero_count ?? 1};
- story: от ${selection.story_min ?? 6} до ${selection.story_max ?? 8};
- по умолчанию не более ${selection.max_story_per_duplicate_group ?? 1} story из одной duplicate_group;
- исключения по группам: ${JSON.stringify(overrides)};
- разные story должны выполнять разные визуальные функции;
- хорошие второстепенные кадры отправляй в backstage;
- слабые или лишние повторы отправляй в skip;
- низкоуверенные локации не привязывай к конкретному месту;
- запрещённые формулировки: ${(language.forbidden_phrases || []).map(value => `«${value}»`).join(", ") || "нет"};
- не называй кадр технически слабее, если его техническая оценка не ниже сравниваемых кадров.
`;
}

export function validateEditorialRecommendation(raw, items, policy) {
  const ids = items.map(item => item.public_id);
  const byId = new Map(items.map(item => [item.public_id, item]));
  const decisions = raw?.decisions || {};
  const errors = [];
  const selection = policy.selection || {};
  const language = policy.language || {};

  for (const id of ids) {
    const decision = decisions[id];
    if (!decision) {
      errors.push(`нет решения для ${id}`);
      continue;
    }
    if (!["hero", "story", "backstage", "skip"].includes(decision.status)) {
      errors.push(`недопустимый статус для ${id}`);
    }
    if (/IMG\d+_/i.test(decision.duplicate_group || "")) {
      errors.push(`duplicate_group содержит public_id для ${id}`);
    }
    const text = `${decision.reason || ""} ${decision.visual_function || ""}`.toLowerCase();
    for (const phrase of language.forbidden_phrases || []) {
      if (text.includes(String(phrase).toLowerCase())) errors.push(`запрещённая фраза «${phrase}» для ${id}`);
    }
    if (language.forbid_technical_comparison_without_score_difference && /техническ\w*\s+слаб/i.test(decision.reason || "")) {
      const ownScore = Number(byId.get(id)?.technical_quality?.score);
      const peers = ids
        .filter(otherId => otherId !== id && decisions[otherId]?.duplicate_group && decisions[otherId]?.duplicate_group === decision.duplicate_group)
        .map(otherId => Number(byId.get(otherId)?.technical_quality?.score))
        .filter(Number.isFinite);
      if (!Number.isFinite(ownScore) || !peers.some(score => score > ownScore)) {
        errors.push(`неподтверждённое техническое сравнение для ${id}`);
      }
    }
  }

  const heroCount = ids.filter(id => decisions[id]?.status === "hero").length;
  if (heroCount !== (selection.hero_count ?? 1)) errors.push(`hero=${heroCount}`);

  const storyIds = ids.filter(id => decisions[id]?.status === "story");
  if (storyIds.length < (selection.story_min ?? 6) || storyIds.length > (selection.story_max ?? 8)) {
    errors.push(`story=${storyIds.length}, требуется ${selection.story_min ?? 6}-${selection.story_max ?? 8}`);
  }

  if (selection.prefer_distinct_visual_functions) {
    const counts = new Map();
    for (const id of storyIds) {
      const group = String(decisions[id]?.duplicate_group || "").trim().toLowerCase();
      if (!group) continue;
      counts.set(group, (counts.get(group) || 0) + 1);
    }
    for (const [group, count] of counts) {
      const allowed = selection.max_story_per_duplicate_group_overrides?.[group] ?? selection.max_story_per_duplicate_group ?? 1;
      if (count > allowed) errors.push(`в группе «${group}» story=${count}, максимум ${allowed}`);
    }
  }

  if (selection.require_skip_when_redundancy_exists) {
    const grouped = new Map();
    for (const id of ids) {
      const group = String(decisions[id]?.duplicate_group || "").trim().toLowerCase();
      if (!group) continue;
      if (!grouped.has(group)) grouped.set(group, []);
      grouped.get(group).push(id);
    }
    const redundant = [...grouped.values()].some(group => group.length >= 3);
    const skipCount = ids.filter(id => decisions[id]?.status === "skip").length;
    if (redundant && skipCount === 0) errors.push("есть повторяющиеся группы, но нет ни одного skip");
  }

  return {ok: errors.length === 0, errors};
}
