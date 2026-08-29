import { parseChapters } from "./lib/chapter-parser.mjs?v=1";
const STORAGE_KEY = "travel-journal-author-draft-v1";
const form = document.querySelector("#trip-form");
const chaptersRoot = document.querySelector("#chapters");
const template = document.querySelector("#chapter-template");
const preview = document.querySelector("#preview");
const saveState = document.querySelector("#save-state");
const coverInput = document.querySelector("#cover");
const serviceState = document.querySelector("#photo-service-state");
const showGoogleUserId = document.querySelector("#show-google-user-id");
const submitButton = document.querySelector("#submit-trip");
const submissionResult = document.querySelector("#submission-result");
let cover = { name: "", type: "", size: 0 };
let photoPicker;
let stableTripId = "";

const transliterate = value => String(value || "").toLowerCase().split("").map(character => ({а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ы:"y",э:"e",ю:"yu",я:"ya",ь:"",ъ:""}[character] ?? character)).join("");
const slugify = value => transliterate(value).normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `trip-${new Date().getFullYear()}`;
const splitTags = value => String(value || "").split(",").map(item => item.trim()).filter(Boolean);
const escapeHtml = value => String(value || "").replace(/[&<>\"]/g, character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[character]);

function addChapter(data = {}) {
  const chapter = template.content.firstElementChild.cloneNode(true);
  chapter.querySelectorAll("[data-field]").forEach(input => {
    if (input.type !== "file") input.value = data[input.dataset.field] || "";
  });
  chapter.dataset.photos = JSON.stringify(data.photos || []);
  chapter.dataset.chapterId = inferPhotoTarget(data.photos)?.chapter || data.id || "";
  chapter.querySelector("[data-remove]").onclick = () => { chapter.remove(); changed(); };
  chapter.querySelector('[data-field="photos"]').onchange = event => {
    const photos = [...event.target.files].map(file => ({ name: file.name, type: file.type, size: file.size, last_modified: file.lastModified }));
    chapter.dataset.photos = JSON.stringify(photos);
    renderPhotoNames(chapter, photos);
    changed();
  };
  const googlePhotosButton = chapter.querySelector("[data-google-photos]");
  googlePhotosButton.disabled = !photoPicker;
  googlePhotosButton.onclick = async () => {
    const progress = chapter.querySelector(".photo-progress");
    try {
      if (!photoPicker) throw new Error("Подключение Google Фото ещё не готово");
      progress.textContent = "Открываем Google Фото…";
      stableTripId ||= slugify(form.elements.title.value);
      chapter.dataset.chapterId ||= uniqueChapterId(slugify(chapter.querySelector('[data-field="title"]').value), chapter);
      const photos = await photoPicker.pick({ tripId: stableTripId, chapterId: chapter.dataset.chapterId, onProgress: message => { progress.textContent = message; } });
      chapter.dataset.photos = JSON.stringify(photos);
      renderPhotoNames(chapter, photos);
      progress.textContent = `Загружено: ${photos.length}`;
      changed();
    } catch (error) { progress.textContent = `Ошибка: ${error.message}`; }
  };
  renderPhotoNames(chapter, data.photos || []);
  chaptersRoot.append(chapter);
}

function inferPhotoTarget(photos = []) {
  const parts = String(photos.find(photo => photo.key)?.key || "").split("/");
  return parts.length >= 3 ? { trip: parts[0], chapter: parts[1] } : null;
}

function uniqueChapterId(base, current) {
  const used = new Set([...chaptersRoot.children].filter(chapter => chapter !== current).map(chapter => chapter.dataset.chapterId || slugify(chapter.querySelector('[data-field="title"]').value)));
  let candidate = base; let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function renderPhotoNames(chapter, photos) {
  chapter.querySelector(".photo-list").innerHTML = photos.map(photo => `<span>${escapeHtml(photo.name)}</span>`).join("");
}

function collect() {
  const values = Object.fromEntries(new FormData(form).entries());
  const chapters = [...chaptersRoot.children].map((chapter, index) => {
    const get = name => chapter.querySelector(`[data-field="${name}"]`)?.value.trim() || "";
    const photos = JSON.parse(chapter.dataset.photos || "[]");
    const id = chapter.dataset.chapterId || slugify(get("title")) || `chapter-${index + 1}`;
    return { id, title: get("title"), description: get("description"), themes: splitTags(get("themes")), places: splitTags(get("places")), photos };
  }).filter(chapter => chapter.title || chapter.description || chapter.photos.length);
  return { schema_version: 1, type: "new_trip_request", created_at: new Date().toISOString(), trip: { id: stableTripId || slugify(values.title), title: values.title?.trim() || "Без названия", subtitle: values.subtitle?.trim() || "", period: values.period?.trim() || "", description: values.description?.trim() || "", cover }, chapters };
}

function renderPreview(data = collect()) {
  preview.innerHTML = `<small>${escapeHtml(data.trip.period || "Период пока не указан")}</small><h3>${escapeHtml(data.trip.title)}</h3><p>${escapeHtml(data.trip.subtitle || data.trip.description || "Добавьте короткое описание")}</p><strong>${data.chapters.length} ${data.chapters.length === 1 ? "глава" : "глав"} · ${data.chapters.reduce((sum, chapter) => sum + chapter.photos.length, 0)} фотографий</strong>`;
}

function changed() {
  const data = collect();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  saveState.textContent = "Сохранено на этом устройстве";
  renderPreview(data);
}

function restore() {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (!saved) return addChapter();
  const uploadedTarget = (saved.chapters || []).map(chapter => inferPhotoTarget(chapter.photos)).find(Boolean);
  stableTripId = uploadedTarget?.trip || saved.trip?.id || "";
  for (const [name, value] of Object.entries(saved.trip || {})) {
    const input = form.elements[name];
    if (input && input.type !== "file") input.value = value || "";
  }
  cover = saved.trip.cover || cover;
  (saved.chapters?.length ? saved.chapters : [{}]).forEach(addChapter);
  renderPreview(saved);
}

coverInput.addEventListener("change", () => {
  const file = coverInput.files[0];
  if (!file) return;
  cover = { name: file.name, type: file.type, size: file.size, last_modified: file.lastModified };
  document.querySelector("#cover-label").textContent = file.name;
  const image = document.querySelector("#cover-preview");
  image.src = URL.createObjectURL(file);
  image.hidden = false;
  changed();
});
document.querySelector("#add-chapter").onclick = () => { addChapter(); changed(); chaptersRoot.lastElementChild.scrollIntoView({ behavior: "smooth" }); };
document.querySelector("#parse-chapters").onclick = () => {
  const result = document.querySelector("#parse-result");
  const parsed = parseChapters(document.querySelector("#chapters-text").value);
  if (!parsed.length) { result.hidden = false; result.textContent = "Не нашёл главы. Начните каждую с «Глава 1 — Название»."; return; }
  const existingPhotos = new Map([...chaptersRoot.children].map(chapter => [slugify(chapter.querySelector('[data-field="title"]').value), JSON.parse(chapter.dataset.photos || "[]")]));
  chaptersRoot.replaceChildren();
  parsed.forEach(chapter => addChapter({ ...chapter, photos: existingPhotos.get(slugify(chapter.title)) || [] }));
  result.hidden = false; result.textContent = `Заполнено глав: ${parsed.length}. Уже загруженные фотографии глав с теми же названиями сохранены.`;
  changed();
};
document.querySelector("#reset").onclick = () => { if (confirm("Удалить черновик и начать заново?")) { localStorage.removeItem(STORAGE_KEY); location.reload(); } };
form.addEventListener("input", changed);
function downloadBackup(data = collect()) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  link.download = `${data.trip.id}-new-trip.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
document.querySelector("#download-backup").onclick = () => downloadBackup();
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = collect();
  if (!photoPicker) { submissionResult.hidden = false; submissionResult.textContent = "Автоматическая отправка пока не готова. Скачайте резервную копию JSON."; return; }
  const incomplete = data.chapters.filter(chapter => !chapter.photos.length || chapter.photos.some(photo => !photo.url || !photo.key));
  if (incomplete.length) { submissionResult.hidden = false; submissionResult.textContent = `Сначала загрузите фотографии в R2 для глав: ${incomplete.map(chapter => chapter.title).join(", ")}.`; return; }
  const misplaced = data.chapters.flatMap(chapter => chapter.photos.filter(photo => !String(photo.key).startsWith(`${data.trip.id}/${chapter.id}/`)).map(photo => ({ chapter, photo })));
  if (misplaced.length) { submissionResult.hidden = false; submissionResult.textContent = `Фотографии привязаны к старым идентификаторам. Перезагрузите фото в главах: ${[...new Set(misplaced.map(item => item.chapter.title))].join(", ")}. Сами файлы в R2 не потеряны.`; return; }
  submitButton.disabled = true; submitButton.textContent = "Отправляем…"; submissionResult.hidden = false; submissionResult.textContent = "Передаём заявку в редакционный процесс…";
  try {
    const result = await photoPicker.submit(data);
    const links = result.chapters.map(chapter => `<a href="${escapeHtml(chapter.editor_url)}">Редактор: ${escapeHtml(data.chapters.find(item => item.id === chapter.id)?.title || chapter.id)}</a>`).join("");
    submissionResult.innerHTML = `<strong>Заявка принята.</strong><p>Анализ выполняется автоматически. На странице статуса ссылки станут активными после подготовки.</p><a href="${escapeHtml(result.status_url)}">Открыть статус путешествия</a>${links}`;
    saveState.textContent = "Заявка отправлена — можно закрыть страницу";
  } catch (error) { submissionResult.textContent = `Не удалось отправить: ${error.message}. Черновик сохранён; можно повторить или скачать резервную копию.`; }
  finally { submitButton.disabled = false; submitButton.textContent = "Отправить и запустить обработку"; }
});
restore();

Promise.all([import("./lib/photo-services-config.mjs?v=25"), import("./google-photos-picker.js?v=26")]).then(async ([{ photoServicesReady, validatePhotoServicesConfig }, { GooglePhotosPicker }]) => {
  const response = await fetch("./config/photo-services.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const config = validatePhotoServicesConfig(await response.json());
  if (photoServicesReady(config)) {
    photoPicker = new GooglePhotosPicker(config);
    document.querySelectorAll("[data-google-photos]").forEach(button => { button.disabled = false; });
    showGoogleUserId.disabled = false;
    serviceState.textContent = "Google Фото и хранилище подключены.";
    serviceState.classList.add("ready");
  } else {
    serviceState.textContent = "Google OAuth подключён. Осталось настроить хранилище фотографий Cloudflare R2.";
  }
}).catch(error => { serviceState.textContent = `Настройка Google Фото не загружена: ${error.message}`; });

showGoogleUserId.onclick = async () => {
  try {
    if (!photoPicker) throw new Error("Подключение Google Фото ещё не готово");
    serviceState.textContent = "Проверяем Google-аккаунт…";
    const identity = await photoPicker.identify();
    if (!identity.google_email) throw new Error("Google не вернул email. Войдите заново и разрешите просмотр email.");
    serviceState.textContent = `Ваш Google-аккаунт: ${identity.google_email}. Добавьте этот адрес в ALLOWED_GOOGLE_EMAILS в настройках Worker.`;
  } catch (error) { serviceState.textContent = `Не удалось проверить Google-аккаунт: ${error.message}`; }
};
