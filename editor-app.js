const params = new URLSearchParams(location.search);
const clean = (value, fallback) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || fallback;
const trip = clean(params.get("trip"), "kyrgyzstan-2026");
const chapter = clean(params.get("chapter") || params.get("day") || params.get("day_tag"), "day02");
const base = `data/${trip}/${chapter}`;
const paths = { photos: `${base}-photos.json`, analysis: `${base}-analysis.json`, ai: `${base}-ai-review.json` };
const storageKey = `${trip}-${chapter}-author-review-v2`;
const rawBase = "https://raw.githubusercontent.com/rvkrin2-collab/travel-journal/main/";
const grid = document.querySelector("#grid");
const sourceNote = document.querySelector("#sourceNote");
const saveNote = document.querySelector("#saveNote");
let inventory, photos, analysis, aiReview, importedUnknown = [];

const photoId = photo => String(photo.photo_id || photo.public_id || photo.key || "");
const items = value => Array.isArray(value) ? value : value?.items || [];
const fingerprint = value => value?.photos_fingerprint || "legacy-no-fingerprint";
const setNote = text => { saveNote.textContent = text; };
async function load(path) { const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" }); if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response.json(); }
async function loadWithLegacyRemote(path) { try { return { data: await load(path), source: path }; } catch (localError) { const remote = `${rawBase}${path}`; return { data: await load(remote), source: remote, warning: localError.message }; } }
function assertCoverage(label, artifact) {
  const expected = new Set(photos.map(photoId)); const actual = items(artifact).map(photoId);
  if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some(id => !expected.has(id))) throw new Error(`${label}: набор кадров не совпадает с photos.json`);
  if (fingerprint(inventory) !== "legacy-no-fingerprint" && fingerprint(artifact) !== fingerprint(inventory)) throw new Error(`${label}: устаревший fingerprint`);
}
function imageUrl(url) { return url.includes("/image/upload/") ? url.replace("/image/upload/", "/image/upload/f_auto,q_auto,w_900/") : url; }
function card(photo, index) {
  const article = document.createElement("article"); article.className = "card"; article.dataset.publicId = photoId(photo); article.dataset.number = index + 1;
  const img = document.createElement("img"); img.className = "thumb"; img.src = imageUrl(photo.url); img.alt = `Фото ${index + 1}`; img.loading = "lazy";
  const info = document.createElement("div"); info.className = "info";
  const id = document.createElement("div"); id.className = "id"; id.textContent = photoId(photo);
  const choices = document.createElement("div"); choices.className = "choices";
  for (const [value, label] of [["hero", "⭐ Главное"], ["story", "✅ В рассказ"], ["backstage", "📦 За кадром"], ["skip", "❌ Не использовать"], ["unset", "⚪ Не выбрано"]]) { const option = document.createElement("label"); option.className = "choice"; const radio = document.createElement("input"); radio.type = "radio"; radio.name = `status-${index}`; radio.value = value; if (value === "unset") radio.checked = true; option.append(radio, label); choices.append(option); }
  const labelHint = document.createElement("p"); labelHint.className = "hint"; labelHint.textContent = "Что на фотографии"; const labelInput = document.createElement("input"); labelInput.type = "text"; labelInput.dataset.field = "label";
  const noteHint = document.createElement("p"); noteHint.className = "hint"; noteHint.textContent = "Что важно рассказать"; const noteInput = document.createElement("textarea"); noteInput.dataset.field = "note";
  info.append(id, choices, labelHint, labelInput, noteHint, noteInput); article.append(img, info); return article;
}
function apply(review) { const byId = new Map(items(review).map(item => [photoId(item), item])); for (const card of grid.children) { const item = byId.get(card.dataset.publicId); if (!item) continue; card.querySelector(`input[value="${item.status}"]`)?.click(); card.querySelector('[data-field="label"]').value = item.label || ""; card.querySelector('[data-field="note"]').value = item.note || ""; } importedUnknown = items(review).filter(item => !photos.some(photo => photoId(photo) === photoId(item))); }
function collect() { return { schema_version: 2, trip, chapter, day: chapter, status: "author_review", approval: "photo_selection_approved", photos_source: paths.photos, ai_review_source: paths.ai, photos_fingerprint: fingerprint(inventory), updated_at: new Date().toISOString(), items: [...grid.children].map(card => ({ photo_id: card.dataset.publicId, public_id: card.dataset.publicId, number: Number(card.dataset.number), status: card.querySelector('input[type="radio"]:checked')?.value || "unset", label: card.querySelector('[data-field="label"]').value.trim(), note: card.querySelector('[data-field="note"]').value.trim() })) }; }
function validate(review) { if (importedUnknown.length) throw new Error(`Импорт содержит ${importedUnknown.length} неизвестных кадров; экспорт остановлен`); if (review.items.some(item => item.status === "unset")) throw new Error("Выберите решение для каждого кадра"); if (review.items.filter(item => item.status === "hero").length !== 1) throw new Error("Нужно выбрать ровно одно главное фото"); if (review.items.some(item => !item.label)) throw new Error("Заполните «Что на фотографии» для каждого кадра"); }
function save() { const review = collect(); localStorage.setItem(storageKey, JSON.stringify(review)); setNote("Решения сохранены в этом браузере."); }
function exportReview() { try { const review = collect(); validate(review); localStorage.setItem(storageKey, JSON.stringify(review)); const url = URL.createObjectURL(new Blob([JSON.stringify(review, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `${chapter}-author-review.json`; link.click(); URL.revokeObjectURL(url); setNote("Первый этап утверждён: author-review скачан."); } catch (error) { setNote(`Нельзя завершить: ${error.message}`); } }
async function init() {
  document.querySelector("#pageTitle").textContent = `${chapter} · ${trip}`; document.querySelector("#footerText").textContent = `${trip} · ${chapter}`;
  const photoLoaded = await loadWithLegacyRemote(paths.photos); inventory = photoLoaded.data; photos = items(inventory); if (!photos.length) throw new Error("photos.json пуст");
  analysis = await load(paths.analysis); aiReview = await load(paths.ai); assertCoverage("analysis", analysis); assertCoverage("ai-review", aiReview);
  grid.replaceChildren(...photos.map(card)); apply(aiReview);
  const saved = JSON.parse(localStorage.getItem(storageKey) || "null"); if (saved && (saved.photos_fingerprint === fingerprint(inventory) || (!saved.photos_fingerprint && fingerprint(inventory) === "legacy-no-fingerprint"))) apply(saved);
  sourceNote.textContent = `Все ${photos.length} кадров показаны. Analysis: ${items(analysis).length}. AI review: ${items(aiReview).length}. Fingerprint: ${fingerprint(inventory)}. Источник: ${photoLoaded.source}${photoLoaded.warning ? ` (fallback: ${photoLoaded.warning})` : ""}`;
}
document.querySelector("#saveBtn").onclick = save; document.querySelector("#exportBtn").onclick = exportReview;
document.querySelector("#importFile").onchange = async event => { try { const review = JSON.parse(await event.target.files[0].text()); if (review.photos_fingerprint !== fingerprint(inventory) && !(!review.photos_fingerprint && fingerprint(inventory) === "legacy-no-fingerprint")) throw new Error("fingerprint не совпадает"); apply(review); setNote("JSON импортирован; проверьте решения."); } catch (error) { setNote(`Ошибка импорта: ${error.message}`); } };
document.querySelector("#reloadAiBtn").onclick = () => apply(aiReview); document.querySelector("#clearBtn").onclick = () => { if (confirm("Удалить локальные правки?")) { localStorage.removeItem(storageKey); apply(aiReview); } };
init().catch(error => { sourceNote.textContent = `Редактор заблокирован: ${error.message}`; grid.replaceChildren(); });
