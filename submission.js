const params = new URLSearchParams(location.search);
const safe = value => String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
const trip = safe(params.get("trip"));
const root = document.querySelector("#chapters-status");
const title = document.querySelector("#title");
const summary = document.querySelector("#summary");
const overall = document.querySelector("#overall-status");
const escapeHtml = value => String(value || "").replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
let photoPicker;
async function get(path) { const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" }); return response.ok ? response.json() : null; }
function stateFor(values) {
  if (values.approval) return { step: 4, label: "Глава утверждена", action: "Ожидает публикации" };
  if (values.previewReady) return { step: 3, label: "Проверьте готовую главу", action: "Открыть и утвердить preview" };
  if (values.author) return { step: 2, label: "Собираем текст и preview", action: "Ничего делать не нужно" };
  if (values.ready) return { step: 1, label: "Нужен ваш отбор фотографий", action: "Открыть редактор фотографий" };
  return { step: 0, label: "Анализируем фотографии", action: "Ничего делать не нужно" };
}
function renderOverall(states, published) {
  const approved = states.filter(value => value.approval).length;
  const stages = ["Фото загружены", "Отбор фотографий", "Сборка глав", "Проверка preview", "Публикация"];
  overall.innerHTML = `<h2>Путь путешествия</h2><div class="journey-steps">${stages.map((label, index) => `<div class="journey-step ${published || (index < 4 && states.length && states.every(value => stateFor(value).step >= index)) ? "done" : ""}"><b>${index + 1}</b><span>${label}</span></div>`).join("")}</div><p>${published ? "Путешествие опубликовано." : `Полностью утверждено глав: ${approved} из ${states.length}.`}</p>`;
}
async function refresh() {
  if (!trip) { title.textContent = "Не указан идентификатор путешествия"; return; }
  const [tripData, registry] = await Promise.all([get(`data/${trip}/trip.json`), get("data/trips.json")]);
  if (!tripData) { title.textContent = "Заявка принята"; summary.textContent = "Создаём черновик и анализируем фотографии. Здесь пока ничего нажимать не нужно."; root.innerHTML = "<p>Подготовка фотоинвентаря…</p>"; return; }
  const registryTrip = registry?.trips?.find(item => item.id === trip); const published = registryTrip?.status === "completed" && tripData.editorial_status === "published";
  title.textContent = registryTrip?.title || trip;
  const chapters = tripData.views?.find(view => ["chapters", "days"].includes(view.id))?.items || [];
  const states = await Promise.all(chapters.map(async chapter => {
    const base = `data/${trip}/${chapter.id}`;
    const [photos, analysis, ai, author, storyboard, approval] = await Promise.all([get(`${base}-photos.json`), get(`${base}-analysis.json`), get(`${base}-ai-review.json`), get(`${base}-author-review.json`), get(`${base}-storyboard.json`), get(`${base}-approval.json`)]);
    const ready = Boolean(photos && analysis && ai && photos.photos_fingerprint === analysis.photos_fingerprint && photos.photos_fingerprint === ai.photos_fingerprint);
    const previewReady = Boolean(ready && author && storyboard && photos.photos_fingerprint === author.photos_fingerprint && photos.photos_fingerprint === storyboard.photos_fingerprint);
    const approvalValid = Boolean(previewReady && approval?.status === "preview_approved" && approval.photos_fingerprint === photos.photos_fingerprint);
    return { chapter, photos, analysis, ai, author, storyboard, approval: approvalValid ? approval : null, ready, previewReady };
  }));
  renderOverall(states, published);
  const next = states.find(value => !value.approval); summary.textContent = published ? "Готово — путешествие доступно читателям." : next ? `Следующее действие: ${stateFor(next).action}.` : "Все главы утверждены. Выберите обложку и опубликуйте путешествие.";
  root.innerHTML = states.map(value => { const state = stateFor(value); const chapter = value.chapter; const action = value.previewReady && !value.approval ? `<a class="primary status-link" href="preview.html?trip=${trip}&chapter=${chapter.id}">Открыть и утвердить preview</a>` : value.ready && !value.author ? `<a class="primary status-link" href="editor.html?trip=${trip}&chapter=${chapter.id}">Выбрать фотографии</a>` : ""; return `<article class="chapter workflow-card"><div class="chapter-head"><strong>${escapeHtml(chapter.title)}</strong><span>Шаг ${state.step + 1} из 5</span></div><div class="progress"><i style="width:${(state.step + 1) * 20}%"></i></div><h3>${state.label}</h3><p>${state.action}</p>${action}</article>`; }).join("");
  const publish = document.querySelector("#publish-panel");
  if (published) { publish.hidden = false; publish.innerHTML = `<h2>Путешествие опубликовано</h2><a class="primary status-link" href="trips/${trip}/">Открыть путешествие</a>`; }
  else if (states.length && states.every(value => value.approval)) { publish.hidden = false; publish.innerHTML = `<h2>Финальный шаг — публикация</h2><p>Выберите главу, главное фото которой станет обложкой путешествия.</p><label>Обложка<select id="cover-chapter">${states.map(value => `<option value="${value.chapter.id}">${escapeHtml(value.chapter.title)}</option>`).join("")}</select></label><label class="publish-confirm"><input id="publish-confirm" type="checkbox"> Я проверил все главы и прямо разрешаю публикацию</label><button id="publish-trip" class="primary" type="button">Опубликовать путешествие</button><div id="publish-result" class="service-state" hidden></div>`; document.querySelector("#publish-trip").onclick = publishTrip; }
  else publish.hidden = true;
}
async function publishTrip() {
  const result = document.querySelector("#publish-result"); result.hidden = false;
  if (!document.querySelector("#publish-confirm").checked) { result.textContent = "Сначала подтвердите, что проверили все главы."; return; }
  try { if (!photoPicker) throw new Error("Сеанс публикации ещё загружается"); result.textContent = "Отправляем прямую команду публикации…"; const response = await photoPicker.publishTrip({ schema_version: 1, trip, status: "publish_requested", cover_chapter: document.querySelector("#cover-chapter").value, requested_at: new Date().toISOString() }); result.textContent = "Публикация запущена. Страница обновится автоматически."; setTimeout(refresh, 5000); } catch (error) { result.textContent = `Не удалось опубликовать: ${error.message}`; }
}
document.querySelector("#refresh").onclick = refresh;
Promise.all([import("./lib/photo-services-config.mjs?v=23"), import("./google-photos-picker.js?v=23")]).then(async ([{ validatePhotoServicesConfig }, { GooglePhotosPicker }]) => { const response = await fetch("./config/photo-services.json", { cache: "no-store" }); photoPicker = new GooglePhotosPicker(validatePhotoServicesConfig(await response.json())); }).catch(() => {});
refresh(); setInterval(() => { if (!document.hidden) refresh(); }, 15000);
