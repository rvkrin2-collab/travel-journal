import { createGooglePhotosPicker } from "./google-photos-picker.js";

const STORAGE_KEY = "travel-journal-author-draft-v1";
const form = document.querySelector("#trip-form");
const chaptersRoot = document.querySelector("#chapters");
const template = document.querySelector("#chapter-template");
const preview = document.querySelector("#preview");
const saveState = document.querySelector("#save-state");
const coverInput = document.querySelector("#cover");
const serviceState = document.querySelector("#photo-service-state");
let cover = { name: "", type: "", size: 0 };
const googlePhotosPicker = createGooglePhotosPicker();

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
  chapter.querySelector("[data-remove]").onclick = () => { chapter.remove(); changed(); };
  chapter.querySelector('[data-field="photos"]').onchange = event => {
    const photos = [...event.target.files].map(file => ({ name: file.name, type: file.type, size: file.size, last_modified: file.lastModified }));
    chapter.dataset.photos = JSON.stringify(photos);
    renderPhotoNames(chapter, photos);
    changed();
  };
  chapter.querySelector("[data-google-photos]").onclick = async event => {
    const state = chapter.querySelector("[data-picker-state]");
    event.currentTarget.disabled = true;
    state.textContent = "Открываем Google Фото…";
    try {
      const photos = await googlePhotosPicker.pick({ trip: slugify(form.elements.title.value), chapter: slugify(chapter.querySelector('[data-field="title"]').value) });
      chapter.dataset.photos = JSON.stringify([...(JSON.parse(chapter.dataset.photos || "[]")), ...photos]);
      renderPhotoNames(chapter, JSON.parse(chapter.dataset.photos));
      state.textContent = `Добавлено из Google Фото: ${photos.length}`;
      changed();
    } catch (error) {
      state.textContent = `Не удалось выбрать фотографии: ${error.message}`;
    } finally {
      event.currentTarget.disabled = false;
    }
  };
  renderPhotoNames(chapter, data.photos || []);
  chaptersRoot.append(chapter);
}

function renderPhotoNames(chapter, photos) {
  chapter.querySelector(".photo-list").innerHTML = photos.map(photo => `<span>${escapeHtml(photo.name)}</span>`).join("");
}

function collect() {
  const values = Object.fromEntries(new FormData(form).entries());
  const chapters = [...chaptersRoot.children].map((chapter, index) => {
    const get = name => chapter.querySelector(`[data-field="${name}"]`).value.trim();
    return { id: slugify(get("title")) || `chapter-${index + 1}`, title: get("title"), description: get("description"), themes: splitTags(get("themes")), places: splitTags(get("places")), photo_source_url: get("photo_source_url"), photos: JSON.parse(chapter.dataset.photos || "[]") };
  }).filter(chapter => chapter.title || chapter.description || chapter.photo_source_url || chapter.photos.length);
  return { schema_version: 1, type: "new_trip_request", created_at: new Date().toISOString(), trip: { id: slugify(values.title), title: values.title?.trim() || "Без названия", subtitle: values.subtitle?.trim() || "", period: values.period?.trim() || "", description: values.description?.trim() || "", cover }, chapters };
}

function renderPreview(data = collect()) {
  const albums = data.chapters.filter(chapter => chapter.photo_source_url).length;
  preview.innerHTML = `<small>${escapeHtml(data.trip.period || "Период пока не указан")}</small><h3>${escapeHtml(data.trip.title)}</h3><p>${escapeHtml(data.trip.subtitle || data.trip.description || "Добавьте короткое описание")}</p><strong>${data.chapters.length} ${data.chapters.length === 1 ? "глава" : "глав"} · ${data.chapters.reduce((sum, chapter) => sum + chapter.photos.length, 0)} файлов · ${albums} альбомов Google Фото</strong>`;
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
document.querySelector("#reset").onclick = () => { if (confirm("Удалить черновик и начать заново?")) { localStorage.removeItem(STORAGE_KEY); location.reload(); } };
form.addEventListener("input", changed);
form.addEventListener("submit", event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = collect();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  link.download = `${data.trip.id}-new-trip.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  saveState.textContent = "Заявка скачана — отправьте файл редактору";
});
restore();

import("./lib/photo-services-config.mjs").then(async ({ photoServicesReady, validatePhotoServicesConfig }) => {
  const response = await fetch("./config/photo-services.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const config = validatePhotoServicesConfig(await response.json());
  if (photoServicesReady(config)) {
    serviceState.textContent = "Google Фото и хранилище подключены.";
    serviceState.classList.add("ready");
  } else {
    serviceState.textContent = "Google OAuth подключён. Осталось настроить хранилище фотографий Cloudflare R2.";
  }
}).catch(error => { serviceState.textContent = `Настройка Google Фото не загружена: ${error.message}`; });
