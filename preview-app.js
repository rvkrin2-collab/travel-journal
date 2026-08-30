const params = new URLSearchParams(location.search);
const clean = (value, fallback) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "") || fallback;
const trip = clean(params.get("trip"), "kyrgyzstan-2026");
const chapter = clean(params.get("chapter") || params.get("day") || params.get("day_tag"), "day02");
const base = `data/${trip}/${chapter}`;
const paths = { photos: `${base}-photos.json`, author: `${base}-author-review.json`, final: `${base}-final-review.json`, storyboard: `${base}-storyboard.json`, feedback: `${base}-author-feedback.json` };
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
const previewImage = (photo, width = 1400) => photo.key ? `https://upload.owntravel.ru/thumbnail/${String(photo.key).split("/").map(encodeURIComponent).join("/")}?w=${width}` : imgUrl(photo.url, width);
async function load(path, optional = false) { const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" }); if (!response.ok) { if (optional && response.status === 404) return null; throw new Error(`${path}: HTTP ${response.status}`); } diagnostics.push(`${path}: OK`); return response.json(); }
function exact(inventory, artifact, label) { const expected = new Set(items(inventory).map(photoId)); const actual = items(artifact).map(photoId); if (actual.length !== expected.size || new Set(actual).size !== actual.length || actual.some(id => !expected.has(id))) throw new Error(`${label} не соответствует исходному набору`); if (fp(inventory) !== "legacy-no-fingerprint" && fp(artifact) !== fp(inventory)) throw new Error(`${label}: устаревший fingerprint`); }

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
  const status = document.querySelector("#authorNoteStatus");
  const button = document.querySelector("#sendNoteBtn");
  const text = document.querySelector("#noteText").value.trim();
  if (!text) { status.textContent = "Напишите замечание."; return; }
  const feedback = { schema_version: 1, trip, chapter, status: "preview_feedback", type: document.querySelector("#noteType").value, photo: document.querySelector("#notePhoto").value.trim(), text, photos_fingerprint: fp(currentInventory), author_review_updated_at: currentAuthor?.updated_at || "", storyboard_updated_at: currentStoryboard?.updated_at || "", submitted_at: new Date().toISOString() };
  try {
    if (!photoPicker) throw new Error("Подключение отправки ещё загружается");
    button.disabled = true;
    status.textContent = "Сохраняем замечание и запускаем новую редакцию…";
    const result = await photoPicker.submitPreviewFeedback(feedback);
    document.querySelector("#noteText").value = "";
    document.querySelector("#notePhoto").value = "";
    status.innerHTML = `Замечание отправлено. Новая версия storyboard будет собрана автоматически. <a href="${esc(result.status_url)}">Открыть статус путешествия</a>`;
  } catch (error) { status.textContent = `Не удалось отправить замечание: ${error.message}`; }
  finally { button.disabled = false; }
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
  document.querySelector("#approvePreviewBtn").onclick = async () => {
    const approval = { schema_version: 2, trip, chapter, status: "preview_approved", photos_fingerprint: fp(inventory), author_review_source: paths.author, author_review_updated_at: author.updated_at || "", storyboard_source: paths.storyboard, storyboard_updated_at: storyboard.updated_at, approved_at: new Date().toISOString() };
    const status = document.querySelector("#authorNoteStatus");
    try {
      if (!photoPicker) throw new Error("Подключение отправки ещё загружается");
      status.textContent = "Сохраняем второе утверждение…";
      const result = await photoPicker.approvePreview(approval);
      status.innerHTML = `Preview утверждён. Публикация не выполнена. <a href="${esc(result.status_url)}">Вернуться к статусу путешествия</a>`;
    } catch (error) { status.textContent = `Не удалось сохранить утверждение: ${error.message}`; }
  };
}

init().catch(error => {
  storyPhotos.innerHTML = `<div class="loading"><b>Предпросмотр заблокирован.</b><br>${esc(error.message)}<br><small>${esc(diagnostics.join(" · "))}</small></div>`;
  document.querySelector("#approvePreviewBtn").disabled = true;
  document.querySelector("#sendNoteBtn").disabled = true;
});

Promise.all([import("./lib/photo-services-config.mjs?v=24"), import("./google-photos-picker.js?v=25")]).then(async ([{ validatePhotoServicesConfig }, { GooglePhotosPicker }]) => {
  const response = await fetch("./config/photo-services.json", { cache: "no-store" });
  photoPicker = new GooglePhotosPicker(validatePhotoServicesConfig(await response.json()));
}).catch(error => diagnostics.push(`approval: ${error.message}`));
