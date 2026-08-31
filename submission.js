import { CHAPTER_STAGES, chapterStatus, overallProgress, overallStateLabel } from "./lib/submission-status.mjs?v=2";

const params = new URLSearchParams(location.search);
const safe = value => String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
const trip = safe(params.get("trip"));
const root = document.querySelector("#chapters-status");
const title = document.querySelector("#title");
const summary = document.querySelector("#summary");
const overall = document.querySelector("#overall-status");
const live = document.querySelector("#live-status");
const refreshButton = document.querySelector("#refresh");
const escapeHtml = value => String(value || "").replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
let photoPicker, photoPickerPromise, refreshing = false, retrying = false, secondsToRefresh = 15;
const PROCESSING_KEY = `travel-journal-processing-${trip}`;
const PROCESSING_WINDOW_MS = 20 * 60 * 1000;

function processingAttempt() {
  try {
    const value = JSON.parse(localStorage.getItem(PROCESSING_KEY) || "null");
    if (!value?.started_at || Date.now() - Date.parse(value.started_at) > PROCESSING_WINDOW_MS) {
      localStorage.removeItem(PROCESSING_KEY);
      return null;
    }
    return value;
  } catch { return null; }
}

function rememberProcessing() {
  const value = { started_at: new Date().toISOString() };
  localStorage.setItem(PROCESSING_KEY, JSON.stringify(value));
  return value;
}

async function get(path) {
  try {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } catch (error) { throw new Error(`Не удалось получить ${path}: ${error.message}`); }
}
function dateTime(value) { return value ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "изменений ещё не было"; }
function renderOverall(states, published) {
  const progress = overallProgress(states.map(value => value.status), published);
  const stalled = states.filter(value => value.status.kind === "stalled").length;
  const label = overallStateLabel(states.map(value => value.status), published);
  overall.innerHTML = `<div class="overall-head"><div><span class="status-kicker">Общий прогресс</span><h2>${progress.percent}%</h2></div><span class="live-dot ${stalled ? "problem" : published ? "done" : ""}">${label}</span></div><div class="overall-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}"><i style="width:${progress.percent}%"></i></div><div class="journey-steps">${CHAPTER_STAGES.map((stageLabel, index) => `<div class="journey-step ${states.length && states.every(value => value.status.completed[index]) ? "done" : ""}"><b>${index + 1}</b><span>${stageLabel}</span></div>`).join("")}<div class="journey-step ${published ? "done" : ""}"><b>7</b><span>Публикация</span></div></div>`;
}
function actionFor(value) {
  const chapter = value.chapter;
  if (value.status.action === "editor") return `<a class="primary status-link" href="editor.html?trip=${trip}&chapter=${chapter.id}">Выбрать и утвердить фотографии</a>`;
  if (value.status.action === "preview") return `<a class="primary status-link" href="preview.html?trip=${trip}&chapter=${chapter.id}">Проверить и утвердить preview</a>`;
  return "";
}

function retryPanel(states, processingFailure) {
  const stalled = states.filter(value => value.status.kind === "stalled");
  if (!stalled.length) return "";
  const failure = processingFailure ? `<div class="service-state error"><strong>Причина остановки</strong><p>${escapeHtml(processingFailure.message)}</p><p class="last-change">Ошибка зафиксирована: ${dateTime(processingFailure.failed_at)}</p></div>` : "";
  return `<div class="workflow-card stalled retry-box"><h3>Перезапустить обработку путешествия</h3>${failure}<p>Остановлена обработка ${stalled.length} ${stalled.length === 1 ? "главы" : "глав"}. Команда запустит их все сразу.</p><div id="retry-result" class="service-state" role="status" aria-live="polite" hidden></div><button class="primary status-link restart" type="button" data-retry-processing>Повторно запустить обработку</button><p class="restart-note">Фотографии уже загружены — выбирать их заново не потребуется.</p></div>`;
}
function renderChapter(value) {
  const state = value.status;
  const stateName = { working: "В работе", action: "Ваше действие", stalled: "Остановлено", done: "Готово" }[state.kind];
  return `<article class="chapter workflow-card ${state.kind}"><div class="chapter-head"><strong>${escapeHtml(value.chapter.title)}</strong><span class="state-badge">${stateName}</span></div><div class="chapter-progress"><i style="width:${state.percent}%"></i></div><div class="progress-copy"><b>${state.percent}%</b><span>${state.done} из ${state.total} этапов</span></div><h3>${state.label}</h3><p>${state.instruction}</p><p class="last-change">Последнее изменение: ${dateTime(state.lastActivity)}</p>${actionFor(value)}</article>`;
}
function renderPublish(states, published) {
  const panel = document.querySelector("#publish-panel");
  if (published) { panel.hidden = false; panel.innerHTML = `<h2>Путешествие опубликовано</h2><a class="primary status-link" href="trips/${trip}/">Открыть путешествие</a>`; }
  else if (states.length && states.every(value => value.status.kind === "done")) {
    panel.hidden = false; panel.innerHTML = `<h2>Финальный шаг — публикация</h2><p>Выберите главу, главное фото которой станет обложкой путешествия.</p><label>Обложка<select id="cover-chapter">${states.map(value => `<option value="${value.chapter.id}">${escapeHtml(value.chapter.title)}</option>`).join("")}</select></label><label class="publish-confirm"><input id="publish-confirm" type="checkbox"> Я проверил все главы и прямо разрешаю публикацию</label><button id="publish-trip" class="primary" type="button">Опубликовать путешествие</button><div id="publish-result" class="service-state" hidden></div>`; document.querySelector("#publish-trip").onclick = publishTrip;
  } else panel.hidden = true;
}
async function refresh() {
  if (refreshing || retrying) return;
  refreshing = true; refreshButton.disabled = true; live.classList.remove("error"); live.textContent = "Проверяем изменения…";
  try {
    if (!trip) { title.textContent = "Не указан идентификатор путешествия"; summary.textContent = "Откройте страницу статуса из авторской мастерской."; return; }
    const [tripData, registry, processing] = await Promise.all([get(`data/${trip}/trip.json`), get("data/trips.json"), get(`data/${trip}/processing-status.json`)]);
    if (!tripData) { title.textContent = "Заявка принята"; summary.textContent = "Черновик ещё не появился. Обычно это занимает несколько минут."; overall.innerHTML = `<div class="waiting-block"><span class="spinner"></span><div><h2>Создаём путешествие</h2><p>Страница обновляется автоматически. Пока ничего нажимать не нужно.</p></div></div>`; root.innerHTML = ""; return; }
    const registryTrip = registry?.trips?.find(item => item.id === trip);
    const published = registryTrip?.status === "completed" && tripData.editorial_status === "published";
    title.textContent = registryTrip?.title || trip;
    const chapters = tripData.views?.find(view => ["chapters", "days"].includes(view.id))?.items || [];
    let states = await Promise.all(chapters.map(async chapter => {
      const base = `data/${trip}/${chapter.id}`;
      const [photos, analysis, ai, author, storyboard, approval] = await Promise.all(["photos", "analysis", "ai-review", "author-review", "storyboard", "approval"].map(type => get(`${base}-${type}.json`)));
      return { chapter, status: chapterStatus({ photos, analysis, ai, author, storyboard, approval }) };
    }));
    const attempt = processingAttempt();
    const failureIsCurrent = processing?.status === "failed" && (!attempt || Date.parse(processing.failed_at) >= Date.parse(attempt.started_at));
    if (attempt && failureIsCurrent) localStorage.removeItem(PROCESSING_KEY);
    if (attempt && !failureIsCurrent) {
      const startedAt = Date.parse(attempt.started_at);
      const hasNewResult = states.some(value => Date.parse(value.status.lastActivity || 0) > startedAt);
      if (hasNewResult) localStorage.removeItem(PROCESSING_KEY);
      else states = states.map(value => value.status.kind === "stalled" ? { ...value, status: { ...value.status, kind: "working", action: null, label: "Обработка выполняется", instruction: "Анализируем фотографии и готовим редакторский отбор. Обычно это занимает несколько минут." } } : value);
    }
    renderOverall(states, published);
    root.innerHTML = `<div class="section-heading"><div><span class="status-kicker">По главам</span><h2>Что происходит сейчас</h2></div></div>${retryPanel(states, failureIsCurrent ? processing : null)}${states.map(renderChapter).join("")}`;
    document.querySelectorAll("[data-retry-processing]").forEach(button => { button.onclick = retryProcessing; });
    const stalled = states.filter(value => value.status.kind === "stalled"), actions = states.filter(value => value.status.kind === "action"), working = states.filter(value => value.status.kind === "working");
    if (published) summary.textContent = "Готово — путешествие опубликовано.";
    else if (failureIsCurrent) summary.textContent = `Обработка остановилась: ${processing.message}`;
    else if (stalled.length) summary.textContent = `Обработка остановилась в ${stalled.length} ${stalled.length === 1 ? "главе" : "главах"}. Ниже указано, как запустить её снова.`;
    else if (actions.length) summary.textContent = `Сейчас нужен ваш шаг: ${actions[0].status.instruction}`;
    else if (working.length) summary.textContent = "Обработка идёт автоматически. Страницу можно закрыть и вернуться позже.";
    else summary.textContent = "Все главы утверждены. Осталось выбрать обложку и опубликовать путешествие.";
    renderPublish(states, published);
    live.textContent = `Проверено ${new Intl.DateTimeFormat("ru-RU", { timeStyle: "medium" }).format(new Date())}. Следующая проверка через 15 секунд.`; secondsToRefresh = 15;
  } catch (error) { live.textContent = error.message; live.classList.add("error"); }
  finally { refreshing = false; refreshButton.disabled = false; }
}
async function publishTrip() {
  const result = document.querySelector("#publish-result"); result.hidden = false;
  if (!document.querySelector("#publish-confirm").checked) { result.textContent = "Сначала подтвердите, что проверили все главы."; return; }
  try { if (!photoPicker) throw new Error("Сеанс публикации ещё загружается"); result.textContent = "Отправляем прямую команду публикации…"; await photoPicker.publishTrip({ schema_version: 1, trip, status: "publish_requested", cover_chapter: document.querySelector("#cover-chapter").value, requested_at: new Date().toISOString() }); result.textContent = "Публикация запущена. Страница обновится автоматически."; setTimeout(refresh, 5000); } catch (error) { result.textContent = `Не удалось опубликовать: ${error.message}`; }
}
function retryProcessingError(error) {
  const message = String(error?.message || error || "неизвестная ошибка");
  if (/not found|HTTP 404/i.test(message)) return "Сервис повторного запуска ещё не обновлён. Обработка не запущена; требуется публикация Cloudflare Worker.";
  return message;
}
async function retryProcessing() {
  if (retrying) return;
  retrying = true;
  const buttons = [...document.querySelectorAll("[data-retry-processing]")];
  const result = document.querySelector("#retry-result");
  buttons.forEach(button => { button.disabled = true; button.textContent = "Запускаем…"; });
  if (result) { result.hidden = false; result.classList.remove("error"); result.textContent = "Отправляем команду повторного запуска…"; }
  try {
    if (!photoPicker) await loadPhotoPicker();
    if (typeof photoPicker.retryProcessing !== "function") {
      photoPicker = null;
      photoPickerPromise = null;
      await loadPhotoPicker();
    }
    if (typeof photoPicker.retryProcessing !== "function") throw new Error("Модуль запуска устарел. Обновите страницу и повторите попытку.");
    await photoPicker.retryProcessing(trip);
    rememberProcessing();
    document.querySelectorAll(".retry-box .service-state.error").forEach(node => { if (node !== result) node.remove(); });
    summary.textContent = "Повторная обработка запущена. Первые результаты обычно появляются в течение нескольких минут.";
    live.textContent = "Команда принята. Проверяем появление результатов каждые 15 секунд.";
    if (result) result.textContent = "Команда принята. Можно закрыть страницу — обработка продолжится.";
    document.querySelectorAll(".workflow-card.stalled").forEach(card => { card.classList.remove("stalled"); card.classList.add("working"); card.querySelector(".state-badge").textContent = "Запускается"; card.querySelector("h3").textContent = "Обработка запускается"; });
    secondsToRefresh = 5;
  } catch (error) {
    const message = retryProcessingError(error);
    live.textContent = `Не удалось запустить: ${message}`;
    live.classList.add("error");
    if (result) result.textContent = `Не удалось запустить: ${message}`;
    buttons.forEach(button => { button.disabled = false; button.textContent = "Повторно запустить обработку"; });
  } finally {
    retrying = false;
  }
}

async function loadPhotoPicker() {
  if (photoPicker) return photoPicker;
  if (!photoPickerPromise) photoPickerPromise = Promise.all([import("./lib/photo-services-config.mjs?v=25"), import("./google-photos-picker.js?v=27")])
    .then(async ([{ validatePhotoServicesConfig }, { GooglePhotosPicker }]) => {
      const response = await fetch("./config/photo-services.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Настройки подключения: HTTP ${response.status}`);
      photoPicker = new GooglePhotosPicker(validatePhotoServicesConfig(await response.json()));
      return photoPicker;
    })
    .catch(error => { photoPickerPromise = null; throw error; });
  return photoPickerPromise;
}
refreshButton.onclick = refresh;
loadPhotoPicker().catch(() => {});
refresh();
setInterval(() => { if (document.hidden || refreshing || retrying) return; secondsToRefresh--; if (secondsToRefresh <= 0) refresh(); else if (!live.classList.contains("error")) live.textContent = live.textContent.replace(/Следующая проверка через \d+ секунд\./, `Следующая проверка через ${secondsToRefresh} секунд.`); }, 1000);
