const params = new URLSearchParams(location.search);
const clean = (value, fallback) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || fallback;
const trip = clean(params.get("trip"), "kyrgyzstan-2026");
const chapter = clean(params.get("chapter") || params.get("day") || params.get("day_tag"), "day02");
const base = `data/${trip}/${chapter}`;
const paths = { photos: `${base}-photos.json`, author: `${base}-author-review.json`, final: `${base}-final-review.json`, storyboard: `${base}-storyboard.json`, feedback: `${base}-author-feedback.json`, approval: `${base}-approval.json` };
const diagnostics = [];
const photoId = photo => String(photo.photo_id || photo.public_id || photo.key || "");
const items = value => Array.isArray(value) ? value : value?.items || [];
const fp = value => value?.photos_fingerprint || "legacy-no-fingerprint";
let photoPicker;
let currentStoryboard;
let currentAuthor;
let currentInventory;
const heroTitle = document.querySelector("#heroTitle"), heroSubtitle = document.querySelector("#heroSubtitle"), heroHeader = document.querySelector("#heroHeader"), chapterTitle = document.querySelector("#chapterTitle"), chapterIntro = document.querySelector("#chapterIntro"), storyPhotos = document.querySelector("#storyPhotos"), backstagePhotos = document.querySelector("#backstagePhotos"), previewNote = document.querySelector("#previewNote");
const esc = value => String(value || "").replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const imgUrl = (url, width = 1800) => url.includes("/image/upload/") ? url.replace("/image/upload/", `/image/upload/f_auto,q_auto,w_${width}/`) : url;
const previewImage = (photo, width = 1400) => photo.key ? `https://api.owntravel.ru/thumbnail/${String(photo.key).split("/").map(encodeURIComponent).join("/")}?w=${width}` : imgUrl(photo.url, width);
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
async function load(path, optional = false) { const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" }); if (!response.ok) { if (optional && response.status === 404) return null; throw new Error(`${path}: HTTP ${response.status}`); } diagnostics.push(`${path}: OK`); return response.json(); }
async function loadFresh(path) { const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" }); if (response.status === 404) return null; if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`); return response.json(); }
async function waitFor(path, predicate, attempts = 45, interval = 2000) { for (let index = 0; index < attempts; index++) { try { const value = await loadFresh(path); if (value && predicate(value)) return value; } catch {} await sleep(interval); } return null; }
function exact(inventory, artifact, label) { const expected = new Set(items(inventory).map(photoId)); const actual = items(artifact).map(photoId); if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some(id => !expected.has(id))) throw new Error(`${label} не соответствует исходному набору`); if (fp(inventory) !== "legacy-no-fingerprint" && fp(artifact) !== fp(inventory)) throw new Error(`${label}: устаревший fingerprint`); }

function setActionState(state, text, link = null) {
  const status = document.querySelector("#authorNoteStatus");
  status.className = `author-action-status state-${state}`;
  status.replaceChildren(document.createTextNode(text));
  if (link?.href) {
    status.append(document.createTextNode(" "));
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.textContent = link.label || "Открыть статус";
    status.append(anchor);
  }
}

function pickerStatus(event) {
  if (!event?.message) return;
  const state = ({ auth_required: "auth", authorizing: "auth", authorized: "sending", sending: "sending", accepted: "accepted", error: "error" })[event.state] || "sending";
  setActionState(state, event.message);
}

function validateScene(scene, map, index) {
  if (!Array.isArray(scene.photos) || scene.photos.length !== 1) throw new Error(`Сцена ${index + 1}: допустима ровно одна фотография`);
  const photo = map.get(scene.photos[0]);
  if (!photo) throw new Error(`Сцена ${index + 1}: фотография не найдена`);
  const title = String(scene.title || "").trim();
  if (!title) throw new Error(`Сцена ${index + 1}: у фотографии нет индивидуального заголовка`);
  const caption = String(scene.text || "").trim();
  if (!caption) throw new Error(`Сцена ${index + 1}: у фотографии нет индивидуальной подписи`);
  return { photo, title, caption };
}

function sceneHtml(scene, map, index) {
  const { photo, title, caption } = validateScene(scene, map, index);
  return `<section class="scene scene-single"><figure class="scene-photo"><figcaption class="scene-caption"><p class="eyebrow">${String(index + 1).padStart(2, "0")} · ${esc(title)}</p><p>${esc(caption)}</p></figcaption><img src="${esc(previewImage(photo))}" alt="${esc(title)}" loading="lazy" decoding="async"></figure></section>`;
}

function renderFeedback(feedback) {
  const history = document.querySelector("#authorHistory");
  const notes = Array.isArray(feedback?.notes) ? feedback.notes : [];
  history.innerHTML = notes.length ? `<strong>Отправленные замечания</strong>${notes.slice().reverse().map(note => `<article><b>${esc(note.type || "general")}</b>${note.photo ? ` · ${esc(note.photo)}` : ""}<br>${esc(note.text)}</article>`).join("")}` : "";
}

async function sendFeedback() {
  const button = document.querySelector("#sendNoteBtn");
  const text = document.querySelector("#noteText").value.trim();
  if (!text) { setActionState("error", "Напишите замечание."); return; }
  const previousStoryboardRevision = currentStoryboard?.updated_at || "";
  const feedback = { schema_version: 1, trip, chapter, status: "preview_feedback", type: document.querySelector("#noteType").value, photo: document.querySelector("#notePhoto").value.trim(), text, photos_fingerprint: fp(currentInventory), author_review_updated_at: currentAuthor?.updated_at || "", storyboard_updated_at: previousStoryboardRevision, submitted_at: new Date().toISOString() };
  try {
    if (!photoPicker) throw new Error("Подключение отправки ещё загружается");
    button.disabled = true;
    setActionState("sending", "Отправляем замечание…");
    const result = await photoPicker.submitPreviewFeedback(feedback);
    document.querySelector("#noteText").value = "";
    document.querySelector("#notePhoto").value = "";
    setActionState("accepted", "Команда принята сервером. Проверяю, что замечание сохранено…");
    const savedFeedback = await waitFor(paths.feedback, value => Array.isArray(value.notes) && value.notes.some(note => note.submitted_at === feedback.submitted_at), 30);
    if (!savedFeedback) {
      setActionState("accepted", "Команда принята, но подтверждение сохранения ещё не появилось.", { href: result.status_url, label: "Проверить статус" });
      return;
    }
    renderFeedback(savedFeedback);
    setActionState("working", "Замечание сохранено. Собирается новая версия preview…", { href: result.status_url, label: "Открыть статус" });
    const nextStoryboard = await waitFor(paths.storyboard, value => String(value.updated_at || "") && value.updated_at !== previousStoryboardRevision, 45);
    if (!nextStoryboard) return;
    currentStoryboard = nextStoryboard;
    setActionState("done", "Готово: замечание учтено, новая версия preview собрана.", { href: `${location.pathname}?trip=${encodeURIComponent(trip)}&chapter=${encodeURIComponent(chapter)}&v=${Date.now()}`, label: "Открыть новую версию" });
  } catch (error) {
    setActionState("error", `Замечание не отправлено: ${error.message}`);
  } finally { button.disabled = false; }
}

async function approvePreview() {
  const button = document.querySelector("#approvePreviewBtn");
  const approval = { schema_version: 2, trip, chapter, status: "preview_approved", photos_fingerprint: fp(currentInventory), author_review_source: paths.author, author_review_updated_at: currentAuthor?.updated_at || "", storyboard_source: paths.storyboard, storyboard_updated_at: currentStoryboard?.updated_at || "", approved_at: new Date().toISOString() };
  try {
    if (!photoPicker) throw new Error("Подключение отправки ещё загружается");
    button.disabled = true;
    setActionState("sending", "Отправляем утверждение preview…");
    const result = await photoPicker.approvePreview(approval);
    setActionState("accepted", "Команда принята сервером. Проверяю, что утверждение сохранено…");
    const savedApproval = await waitFor(paths.approval, value => value.status === "preview_approved" && value.approved_at === approval.approved_at, 30);
    if (savedApproval) setActionState("done", "Готово: preview утверждён. Публикация не выполнялась.", { href: result.status_url, label: "Вернуться к статусу путешествия" });
    else setActionState("accepted", "Команда принята, но подтверждение сохранения ещё не появилось.", { href: result.status_url, label: "Проверить статус" });
  } catch (error) {
    setActionState("error", `Preview не утверждён: ${error.message}`);
  } finally { button.disabled = false; }
}

async function init() {
  const [inventory, author, final, storyboard, feedback] = await Promise.all([load(paths.photos), load(paths.author), load(paths.final, true), load(paths.storyboard), load(paths.feedback, true)]);
  currentInventory = inventory;
  currentAuthor = author;
  currentStoryboard = storyboard;
  exact(inventory, author, "author-review");
  if (author.schema_version >= 2 && author.approval !== "photo_selection_approved") throw new Error("первое утверждение фотографий отсутствует");
  if (final) exact(inventory, final, "final-review");
  const source = final || author;
  if (storyboard.photos_fingerprint && storyboard.photos_fingerprint !== fp(inventory)) throw new Error("storyboard использует другой набор фотографий");
  if (!String(storyboard.updated_at || "").trim()) throw new Error("storyboard не содержит ревизию");
  const storyboardReviewSource = storyboard.final_review_source || storyboard.review_source || storyboard.author_review_source;
  if (![paths.author, paths.final].includes(storyboardReviewSource)) throw new Error("storyboard не связан с утверждённым author-review");

  const map = new Map(items(inventory).map(photo => [photoId(photo), photo]));
  const hero = items(source).find(item => item.status === "hero");
  if (!hero || !map.has(photoId(hero))) throw new Error("главное фото не найдено");

  const approvedStory = new Set(items(source).filter(item => item.status === "hero" || item.status === "story").map(photoId));
  const scenes = Array.isArray(storyboard.scenes) ? storyboard.scenes : [];
  if (scenes.length !== approvedStory.size) throw new Error(`storyboard: ожидается ${approvedStory.size} отдельных фотографий, получено ${scenes.length} сцен`);
  const seen = new Set();
  scenes.forEach((scene, index) => {
    const { photo } = validateScene(scene, map, index);
    const id = photoId(photo);
    if (!approvedStory.has(id)) throw new Error(`storyboard использует неутверждённый кадр: ${id}`);
    if (seen.has(id)) throw new Error(`storyboard повторяет кадр: ${id}`);
    seen.add(id);
  });
  for (const id of approvedStory) if (!seen.has(id)) throw new Error(`storyboard пропустил утверждённый кадр: ${id}`);

  const chapterData = storyboard.chapter || {};
  document.title = `Предпросмотр · ${chapterData.title || chapter}`;
  heroTitle.textContent = chapterData.title || chapter;
  heroSubtitle.textContent = chapterData.subtitle || chapterData.intro || "";
  chapterTitle.textContent = chapterData.title || chapter;
  chapterIntro.textContent = chapterData.intro || "";
  heroHeader.style.backgroundImage = `linear-gradient(to top,rgba(0,0,0,.68),rgba(0,0,0,.05) 65%),url(${previewImage(map.get(photoId(hero)), 1800)})`;
  storyPhotos.innerHTML = scenes.map((scene, index) => sceneHtml(scene, map, index)).join("");
  backstagePhotos.innerHTML = items(source).filter(item => item.status === "backstage").map(item => { const photo = map.get(photoId(item)); return photo ? `<article class="backstage-card"><img src="${esc(previewImage(photo, 720))}" alt="" loading="lazy" decoding="async"><p>${esc(item.label)}</p></article>` : ""; }).join("");
  previewNote.textContent = `Черновик из утверждённого отбора. Одна фотография — один блок, свой заголовок и подпись. Ревизия: ${storyboard.updated_at}.`;
  renderFeedback(feedback);
  document.querySelector("#sendNoteBtn").onclick = sendFeedback;
  document.querySelector("#approvePreviewBtn").onclick = approvePreview;
}

init().catch(error => {
  storyPhotos.innerHTML = `<div class="loading"><b>Предпросмотр заблокирован.</b><br>${esc(error.message)}<br><small>${esc(diagnostics.join(" · "))}</small></div>`;
  document.querySelector("#approvePreviewBtn").disabled = true;
  document.querySelector("#sendNoteBtn").disabled = true;
});

Promise.all([import("./lib/photo-services-config.mjs?v=25"), import("./google-photos-picker.js?v=28")]).then(async ([{ validatePhotoServicesConfig }, { GooglePhotosPicker }]) => {
  const response = await fetch("./config/photo-services.json", { cache: "no-store" });
  photoPicker = new GooglePhotosPicker(validatePhotoServicesConfig(await response.json())).setStatusReporter(pickerStatus);
}).catch(error => diagnostics.push(`approval: ${error.message}`));
