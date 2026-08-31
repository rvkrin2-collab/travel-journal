import { chapterStatus, overallProgress, overallStateLabel } from "./lib/submission-status.mjs?v=2";
import { validatePhotoServicesConfig } from "./lib/photo-services-config.mjs?v=25";
import { GooglePhotosPicker } from "./google-photos-picker.js?v=27";

const authPanel = document.querySelector("#auth-panel");
const authStatus = document.querySelector("#auth-status");
const dashboard = document.querySelector("#dashboard");
const signIn = document.querySelector("#sign-in");
const escapeHtml = value => String(value || "").replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const safeId = value => String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
let picker;

async function getJson(path) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${path}${separator}v=${Date.now()}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

async function loadPicker() {
  if (picker) return picker;
  const response = await fetch("./config/photo-services.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Настройки доступа: HTTP ${response.status}`);
  picker = new GooglePhotosPicker(validatePhotoServicesConfig(await response.json()));
  picker.setStatusReporter(event => {
    if (!event?.message) return;
    authStatus.hidden = false;
    authStatus.textContent = event.message;
    authStatus.classList.toggle("ready", event.state === "done" || event.state === "accepted");
  });
  return picker;
}

function nextAction(trip, states, published) {
  if (published) return { label: "Открыть на сайте", href: trip.public_path, type: "primary-action" };
  const action = states.find(value => value.status.action === "editor" || value.status.action === "preview");
  if (action?.status.action === "editor") return { label: `Выбрать фото · ${action.chapter.title}`, href: `editor.html?trip=${trip.id}&chapter=${action.chapter.id}`, type: "primary-action" };
  if (action?.status.action === "preview") return { label: `Проверить главу · ${action.chapter.title}`, href: `preview.html?trip=${trip.id}&chapter=${action.chapter.id}`, type: "primary-action" };
  return { label: states.length && states.every(value => value.status.kind === "done") ? "Перейти к публикации" : "Открыть статус", href: `submission.html?trip=${trip.id}`, type: "primary-action" };
}

async function tripState(item) {
  if (item.archived || item.registry_status === "completed") {
    const published = item.registry_status === "completed";
    const progress = { percent: published ? 100 : 0, done: 0, total: 0 };
    const label = item.archived ? "Старая версия" : "Опубликовано";
    return { ...item, id: safeId(item.id), tripData: null, chapters: [], chapterCount: Number(item.chapter_count) || 0, states: [], published, progress, label, action: nextAction(item, [], published) };
  }
  const tripData = await getJson(`${item.data_path}/trip.json`);
  const chapters = tripData?.views?.find(view => ["chapters", "days"].includes(view.id))?.items || [];
  const states = await Promise.all(chapters.map(async chapter => {
    const base = `${item.data_path}/${chapter.id}`;
    const [photos, analysis, ai, author, storyboard, approval] = await Promise.all(["photos", "analysis", "ai-review", "author-review", "storyboard", "approval"].map(type => getJson(`${base}-${type}.json`)));
    return { chapter, status: chapterStatus({ photos, analysis, ai, author, storyboard, approval }) };
  }));
  const processing = await getJson(`${item.data_path}/processing-status.json`);
  const published = item.registry_status === "completed" && (tripData?.editorial_status === "published" || !tripData);
  const progress = overallProgress(states.map(value => value.status), published);
  let label = overallStateLabel(states.map(value => value.status), published);
  if (processing?.status === "failed") label = "Ошибка обработки";
  if (item.archived) label = "Старая версия";
  return { ...item, id: safeId(item.id), tripData, chapters, chapterCount: chapters.length || Number(item.chapter_count) || 0, states, published, progress, label, action: nextAction(item, states, published) };
}

function card(trip) {
  const percent = trip.published ? 100 : trip.progress.percent;
  const secondary = trip.published ? "" : `<a class="secondary-action" href="submission.html?trip=${trip.id}">Статус и все главы</a>`;
  const draft = !trip.published && trip.public_path && !trip.redirects ? `<a href="${escapeHtml(trip.public_path)}">Страница черновика</a>` : "";
  return `<article class="panel trip-admin-card"><div class="trip-card-head"><div><span class="trip-period">${escapeHtml(trip.period || "Период не указан")}</span><h3>${escapeHtml(trip.title)}</h3></div><span class="live-dot ${trip.published ? "done" : trip.label === "Ошибка обработки" ? "problem" : ""}">${escapeHtml(trip.label)}</span></div><p>${escapeHtml(trip.subtitle || `Глав: ${trip.chapterCount}`)}</p><div class="trip-progress"><i style="width:${percent}%"></i></div><div class="trip-progress-copy"><span>Глав: ${trip.chapterCount}</span><b>${percent}%</b></div><div class="trip-actions"><a class="${trip.action.type}" href="${escapeHtml(trip.action.href)}">${escapeHtml(trip.action.label)}</a>${secondary}${draft}</div></article>`;
}

function renderGroup(id, trips, emptyText, countId) {
  document.querySelector(`#${id}`).innerHTML = trips.length ? trips.map(card).join("") : `<div class="empty-admin">${emptyText}</div>`;
  document.querySelector(`#${countId}`).textContent = trips.length;
}

async function renderDashboard() {
  authPanel.hidden = true;
  dashboard.hidden = false;
  const manifest = await getJson("data/admin-trips.json");
  if (!manifest?.trips) throw new Error("Административный список пока не создан");
  const trips = await Promise.all(manifest.trips.map(tripState));
  const drafts = trips.filter(trip => !trip.archived && !trip.published);
  const published = trips.filter(trip => !trip.archived && trip.published);
  const archive = trips.filter(trip => trip.archived);
  drafts.sort((left, right) => Number(right.label === "Ждёт вашего действия") - Number(left.label === "Ждёт вашего действия") || left.title.localeCompare(right.title, "ru"));
  renderGroup("drafts", drafts, "Активных черновиков нет.", "draft-count");
  renderGroup("published", published, "Опубликованных путешествий пока нет.", "published-count");
  document.querySelector("#archive").innerHTML = archive.length ? archive.map(card).join("") : `<div class="empty-admin">Архив пуст.</div>`;
  document.querySelector("#archive-count").textContent = archive.length ? `· ${archive.length}` : "";
  document.querySelector("#archive-section").hidden = !archive.length;
  const actions = drafts.filter(trip => /Ждёт вашего действия|Готово к публикации|Ошибка обработки/.test(trip.label)).length;
  document.querySelector("#admin-summary").innerHTML = `<div class="summary-number"><b>${drafts.length}</b><span>активные черновики</span></div><div class="summary-number"><b>${actions}</b><span>требуют действия</span></div><div class="summary-number"><b>${published.length}</b><span>опубликовано</span></div>`;
}

async function start() {
  try {
    const service = await loadPicker();
    if (service.authorSession() || service.cachedToken()) await renderDashboard();
    else authPanel.hidden = false;
  } catch (error) {
    dashboard.hidden = true;
    authPanel.hidden = false;
    authStatus.hidden = false;
    authStatus.textContent = `Не удалось подготовить вход: ${error.message}`;
  }
}

signIn.onclick = async () => {
  signIn.disabled = true;
  try { await (await loadPicker()).identify(); await renderDashboard(); }
  catch (error) { dashboard.hidden = true; authPanel.hidden = false; authStatus.hidden = false; authStatus.textContent = `Не удалось войти: ${error.message}`; }
  finally { signIn.disabled = false; }
};

start();
