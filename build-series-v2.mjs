import fs from "fs/promises";
import {loadEditorialPolicy, policyPrompt} from "./lib/editorial-policy.mjs";

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_SERIES_MODEL || process.env.OPENAI_VISION_MODEL || "gpt-4o";
const trip = process.env.TRIP || "kyrgyzstan-2026";
const dayTag = normalizeDay(process.env.DAY_TAG || "day01");
const analysisFile = process.env.ANALYSIS_FILE || `data/${trip}/${dayTag}-analysis.json`;
const contextFile = process.env.DAY_CONTEXT_FILE || `data/${trip}/${dayTag}-context.json`;
const authorNotesFile = process.env.AUTHOR_NOTES_FILE || `data/${trip}/${dayTag}-author-notes.json`;

if (!apiKey) throw new Error("OPENAI_API_KEY secret is missing");

function normalizeDay(value) {
  const match = String(value || "").match(/\d+/);
  return match ? `day${String(Number(match[0])).padStart(2, "0")}` : "day01";
}

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function readJsonIfExists(path) {
  try { return await readJson(path); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function callStructured(prompt, schema, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json"},
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: {type: "json_schema", json_schema: schema},
        messages: [{role: "user", content: prompt}]
      })
    });

    if (response.status === 429 && attempt < 5) {
      const body = await response.text();
      const seconds = Number(body.match(/try again in\s+([\d.]+)s/i)?.[1] || 2 ** attempt * 2);
      await sleep(Math.ceil(seconds * 1000) + 500);
      continue;
    }

    if (!response.ok) throw new Error(`${label} error: ${response.status} ${await response.text()}`);
    const data = await response.json();
    const choice = data.choices?.[0];
    console.log(`${label} finish_reason=${choice?.finish_reason || "unknown"}, prompt_tokens=${data.usage?.prompt_tokens || "unknown"}, completion_tokens=${data.usage?.completion_tokens || "unknown"}`);
    if (choice?.finish_reason !== "stop") throw new Error(`${label} incomplete: ${choice?.finish_reason || "unknown"}`);
    if (!choice?.message?.content) throw new Error(`${label} content is empty`);
    return JSON.parse(choice.message.content);
  }
  throw new Error(`${label}: retries exhausted`);
}

function rankingSchema(items) {
  const properties = Object.fromEntries(items.map(item => [item.public_id, {
    type: "object", additionalProperties: false,
    required: ["score", "reason", "visual_function", "duplicate_group"],
    properties: {
      score: {type: "integer", minimum: 0, maximum: 100},
      reason: {type: "string", minLength: 1},
      visual_function: {type: "string", minLength: 1},
      duplicate_group: {type: "string"}
    }
  }]));

  return {
    name: "travel_series_ranking",
    strict: true,
    schema: {
      type: "object", additionalProperties: false,
      required: ["ranking", "sequence_note", "editorial_summary", "fact_checks"],
      properties: {
        ranking: {type: "object", additionalProperties: false, required: items.map(item => item.public_id), properties},
        sequence_note: {type: "string", minLength: 1},
        editorial_summary: {type: "string", minLength: 1},
        fact_checks: {type: "array", items: {type: "string"}}
      }
    }
  };
}

function compactItem(item) {
  return {
    public_id: item.public_id,
    number: item.number,
    orientation: item.orientation,
    visual_summary: item.visual_summary,
    foreground: item.foreground,
    midground: item.midground,
    background: item.background,
    visible_elements: item.visible_elements,
    dominant_subject: item.dominant_subject,
    secondary_subjects: item.secondary_subjects,
    scene_type: item.scene_type,
    people_count: item.people_count,
    animal_count: item.animal_count,
    composition: item.composition,
    technical_quality: item.technical_quality,
    likely_location: item.likely_location,
    location_confidence: item.location_confidence,
    caption_seed: item.caption_seed,
    editor_note: item.editor_note
  };
}

function cleanText(value, policy) {
  let text = String(value || "").trim();
  const replacements = new Map([
    ["кочевой образ жизни", "юрты и открытое пространство"],
    ["традиционный образ жизни", "повседневная сцена"],
    ["идеально передаёт", "точно показывает"],
    ["величие природы", "масштаб пространства"],
    ["гармония с природой", "связь объектов с пейзажем"],
    ["живописный", "выразительный"],
    ["уникальный", "самостоятельный"]
  ]);
  for (const phrase of policy.language?.forbidden_phrases || []) {
    const replacement = replacements.get(String(phrase).toLowerCase()) || "";
    text = text.replace(new RegExp(escapeRegExp(phrase), "gi"), replacement);
  }
  return text.replace(/\s{2,}/g, " ").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function groupKey(entry, id) {
  const group = String(entry.duplicate_group || "").trim().toLowerCase();
  return group || `__unique__:${id}`;
}

function buildDeterministicRecommendation(raw, items, policy) {
  const ranking = raw.ranking || {};
  const selection = policy.selection || {};
  const ids = items.map(item => item.public_id);

  for (const id of ids) {
    if (!ranking[id]) throw new Error(`Series ranking missing public_id: ${id}`);
  }

  const byNumber = new Map(items.map(item => [item.public_id, Number(item.number || 0)]));
  const sorted = [...ids].sort((a, b) => {
    const scoreDiff = Number(ranking[b].score) - Number(ranking[a].score);
    return scoreDiff || byNumber.get(a) - byNumber.get(b);
  });

  const hero = sorted[0];
  const storyMin = selection.story_min ?? 7;
  const storyMax = selection.story_max ?? 10;
  const defaultGroupCap = selection.max_story_per_duplicate_group ?? 1;
  const overrides = selection.max_story_per_duplicate_group_overrides || {};
  const story = [];
  const groupCounts = new Map();

  const heroGroup = groupKey(ranking[hero], hero);
  groupCounts.set(heroGroup, 1);

  function canAddByGroup(id) {
    const key = groupKey(ranking[id], id);
    const visibleGroup = key.startsWith("__unique__:") ? "" : key;
    const cap = visibleGroup ? (overrides[visibleGroup] ?? defaultGroupCap) : 1;
    return (groupCounts.get(key) || 0) < cap;
  }

  function addStory(id) {
    story.push(id);
    const key = groupKey(ranking[id], id);
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  }

  for (const id of sorted.slice(1)) {
    if (story.length >= storyMin) break;
    if (canAddByGroup(id)) addStory(id);
  }

  if (story.length < storyMin) {
    for (const id of sorted.slice(1)) {
      if (story.length >= storyMin) break;
      if (!story.includes(id)) addStory(id);
    }
  }

  const extension = selection.story_extension || {};
  if (extension.enabled !== false && story.length < storyMax) {
    const heroScore = Number(ranking[hero].score) || 0;
    const absoluteFloor = Number(extension.absolute_score_floor ?? 78);
    const relativeFloor = heroScore - Number(extension.max_score_drop_from_hero ?? 12);
    const extensionThreshold = Math.max(absoluteFloor, relativeFloor);

    for (const id of sorted.slice(1)) {
      if (story.length >= storyMax) break;
      if (story.includes(id)) continue;
      if (Number(ranking[id].score) < extensionThreshold) continue;
      if (extension.require_group_capacity !== false && !canAddByGroup(id)) continue;
      addStory(id);
    }
  }

  const selected = new Set([hero, ...story]);
  const maxBackstagePerGroup = selection.max_backstage_per_duplicate_group ?? 1;
  const backstageGroupCounts = new Map();
  const backstage = [];
  const skip = [];
  const skipScoreBelow = selection.skip_score_below ?? 55;

  for (const id of sorted) {
    if (selected.has(id)) continue;
    const key = groupKey(ranking[id], id);
    const score = Number(ranking[id].score) || 0;
    const backstageCount = backstageGroupCounts.get(key) || 0;
    if (score >= skipScoreBelow && backstageCount < maxBackstagePerGroup) {
      backstage.push(id);
      backstageGroupCounts.set(key, backstageCount + 1);
    } else {
      skip.push(id);
    }
  }

  const decisions = {};
  for (const id of ids) {
    let status = "skip";
    if (id === hero) status = "hero";
    else if (story.includes(id)) status = "story";
    else if (backstage.includes(id)) status = "backstage";

    let reason = cleanText(ranking[id].reason, policy);
    if (status === "skip" && Number(ranking[id].score) >= skipScoreBelow) {
      reason = `Лишний повтор в группе «${ranking[id].duplicate_group || ranking[id].visual_function}»; более сильный кадр этой функции уже выбран.`;
    } else if (status === "backstage") {
      reason = `Хороший второстепенный кадр: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
    }

    decisions[id] = {
      status,
      reason,
      visual_function: cleanText(ranking[id].visual_function, policy),
      duplicate_group: cleanText(ranking[id].duplicate_group, policy),
      editorial_score: Number(ranking[id].score)
    };
  }

  return {
    hero,
    story: ids.filter(id => story.includes(id)),
    backstage: ids.filter(id => backstage.includes(id)),
    skip: ids.filter(id => skip.includes(id)),
    decisions,
    sequence_note: cleanText(raw.sequence_note, policy),
    editorial_summary: cleanText(raw.editorial_summary, policy),
    fact_checks: (raw.fact_checks || []).map(value => cleanText(value, policy)).filter(Boolean),
    ranking_method: "single_model_ranking_then_dynamic_7_to_10_policy_assignment"
  };
}

const analysis = await readJson(analysisFile);
const context = await readJsonIfExists(contextFile);
const authorNotes = await readJsonIfExists(authorNotesFile);
const policy = await loadEditorialPolicy({trip, dayTag});
const items = analysis.items || [];
if (!items.length) throw new Error(`${analysisFile} has no analyzed photos`);

const prompt = `Ты выпускающий фоторедактор авторского журнала. Не назначай статусы hero/story/backstage/skip. Только оцени и ранжируй каждый кадр.

Для каждого public_id:
- score от 0 до 100 по визуальной силе, композиции, самостоятельности и роли в серии;
- visual_function — краткая визуальная функция кадра;
- duplicate_group — смысловая группа только для реальных визуальных дублей;
- reason — конкретная причина оценки относительно похожих кадров.

Правила:
- сначала сравни все кадры между собой;
- используй всю шкалу, не ставь большинству кадров почти одинаковые баллы;
- 90-100 — редкие, действительно выдающиеся кадры;
- 80-89 — сильные кадры, достойные основного рассказа;
- 70-79 — хорошие, но второстепенные или менее самостоятельные;
- ниже 70 — слабые, лишние или повторяющиеся;
- авторские заметки задают смысл, но не должны подменять визуальную оценку;
- финальная сцена влияет на порядок истории, но не обязана иметь самый высокий score;
- duplicate_group ставь одинаковой только кадрам с одним главным объектом, близкой композицией и одинаковой визуальной функцией;
- общий фон сам по себе не делает кадры дублями;
- не придумывай культуру, быт, символы и действия;
- не называй кадр технически слабее, если его техническая оценка не ниже;
- duplicate_group никогда не содержит public_id;
- пиши только по-русски.
${policyPrompt(policy)}

КОНТЕКСТ:
${JSON.stringify(context || {}, null, 2)}

АВТОРСКИЕ ЗАМЕТКИ:
${JSON.stringify(authorNotes || {}, null, 2)}

КАДРЫ:
${JSON.stringify(items.map(compactItem), null, 2)}`;

const raw = await callStructured(prompt, rankingSchema(items), "Series ranking");
const recommendation = buildDeterministicRecommendation(raw, items, policy);

analysis.recommendation = recommendation;
analysis.editorial_policy = {
  source: "config/editorial-policy.json",
  version: policy.version,
  validated: true,
  assignment: "dynamic_7_to_10",
  model,
  updated_at: new Date().toISOString()
};
analysis.series_model = model;
analysis.generated_at = new Date().toISOString();

await fs.writeFile(analysisFile, JSON.stringify(analysis, null, 2), "utf8");
console.log(`Saved dynamic policy selection: hero 1, story ${recommendation.story.length}, backstage ${recommendation.backstage.length}, skip ${recommendation.skip.length}`);
