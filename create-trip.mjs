import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function readArguments(values) {
  const result = {};
  for (let index = 0; index < values.length; index++) {
    const key = values[index];
    if (!key.startsWith("--")) throw new Error(`Неизвестный аргумент: ${key}`);
    result[key.slice(2)] = values[++index];
  }
  return result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

export function validateTripId(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value || "")) throw new Error("--id должен состоять из строчных латинских букв, цифр и дефисов");
  return value;
}

export function validatePhotoSourceUrl(value) {
  if (!value) return "";
  const markdownLink = String(value).trim().match(/^\[([^\]]+)]\(([^)]+)\)$/);
  value = markdownLink ? markdownLink[2] : String(value).trim();
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`Некорректная ссылка на Google Фото: ${value}`); }
  if (url.protocol !== "https:" || !["photos.app.goo.gl", "photos.google.com"].includes(url.hostname)) {
    throw new Error(`Ссылка на фотографии должна вести на Google Фото: ${value}`);
  }
  return url.toString();
}

export function normalizeStoredPhoto(photo, chapterId) {
  const markdownLink = String(photo?.url || "").trim().match(/^\[([^\]]+)]\(([^)]+)\)$/);
  const value = markdownLink ? markdownLink[2] : String(photo?.url || "").trim();
  const metadata = { chapter_id: chapterId, key: String(photo?.key || ""), url: "", name: String(photo?.name || "photo"), type: String(photo?.type || "image/jpeg"), size: Number(photo?.size) || 0 };
  if (!value) return metadata;
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`Некорректный адрес загруженной фотографии: ${value}`); }
  if (url.protocol !== "https:" || url.hostname !== "photos.owntravel.ru") throw new Error(`Фотография должна находиться в хранилище сайта: ${value}`);
  return { ...metadata, url: url.toString() };
}

export function tripPage({ id, title, subtitle, period, description, coverUrl }) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · Журнал путешествий</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="stylesheet" href="../../style.css">
  <style>body{margin:0;background:#f4eee4;color:#251f19;font:16px/1.45 Inter,system-ui,sans-serif}.back{display:inline-block;margin:20px;color:inherit}.cover{min-height:58svh;display:flex;align-items:end;padding:36px 20px;background:#263c34 center/cover;color:#fff8ec}.cover h1{font:300 clamp(48px,12vw,112px)/.9 Georgia,serif;letter-spacing:-.05em;margin:8px 0}.cover p{font:22px/1.3 Georgia,serif;max-width:760px}main{max-width:1100px;margin:auto;padding:48px 18px}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.tabs button{border:1px solid #cfc1ae;border-radius:999px;padding:10px 14px;background:#fff8ec;cursor:pointer}.tabs button[aria-selected=true]{background:#263c34;color:white}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}.card{padding:20px;background:#fff8ec;border-radius:18px}.card h3{font:30px/1 Georgia,serif;margin:0 0 10px}.card a{color:inherit}.card-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.card-actions a{padding:9px 12px;border:1px solid #cfc1ae;border-radius:999px;text-decoration:none}.empty{padding:22px;border:1px dashed #aa9c89;border-radius:18px}</style>
</head>
<body data-trip="${escapeHtml(id)}"><a class="back" href="../../index.html">← Все путешествия</a><header class="cover"${coverUrl ? ` style="background-image:linear-gradient(0deg,rgba(0,0,0,.62),rgba(0,0,0,.08)),url('${escapeHtml(coverUrl)}')"` : ""}><div><small>${escapeHtml(period)}</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></header><main><p>${escapeHtml(description)}</p><div id="tabs" class="tabs" aria-label="Способы просмотра"></div><section id="content"></section></main><script src="../../trip-page.js"></script></body></html>`;
}

export async function createTrip(options, baseDirectory = root) {
  const id = validateTripId(options.id);
  if (!options.title) throw new Error("Укажите --title");
  const trip = {
    id,
    title: options.title,
    subtitle: options.subtitle || "Новое путешествие",
    description: options.description || options.subtitle || "Новое путешествие",
    period: options.period || "Дата не указана",
    cover_url: options.cover || "",
    public_path: `trips/${id}/`,
    published_days: 0,
    total_days: 0,
    data_path: `data/${id}`,
    status: options.status || "active"
  };
  const registryPath = path.join(baseDirectory, "data/trips.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  const existingIndex = registry.trips.findIndex(item => item.id === id);
  if (existingIndex >= 0 && !options.replace) throw new Error(`Путешествие ${id} уже существует`);
  if (existingIndex >= 0) registry.trips[existingIndex] = trip;
  else registry.trips.push(trip);
  const chapters = options.chapters || [];
  const grouped = (field, prefix) => [...new Set(chapters.flatMap(chapter => chapter[field] || []))].map(label => ({
    id: `${prefix}-${validateTripId(slugify(label))}`,
    title: label,
    description: `Материалы: ${chapters.filter(chapter => chapter[field]?.includes(label)).map(chapter => chapter.title).join(", ")}`
  }));
  const coverChapterId = options.cover_source_chapter_id || "";
  if (coverChapterId && !chapters.some(chapter => (chapter.id || slugify(chapter.title)) === coverChapterId)) throw new Error(`Глава для обложки не найдена: ${coverChapterId}`);
  // Source album links are credentials-by-possession. Validate them when supplied,
  // but never copy them into files published by GitHub Pages.
  chapters.forEach(chapter => validatePhotoSourceUrl(chapter.photo_source_url));
  const chapterPhotos = new Map(chapters.map(chapter => { const chapterId = chapter.id || slugify(chapter.title); return [chapterId, (chapter.photos || []).map(photo => normalizeStoredPhoto(photo, chapterId))]; }));
  const coverUrl = coverChapterId ? chapterPhotos.get(coverChapterId)?.[0]?.url || "" : options.cover || "";
  trip.cover_url = coverUrl;
  const tripData = { schema_version: 1, trip: id, cover_selection: { chapter_id: coverChapterId, photo_url: coverUrl, status: coverUrl ? "selected" : coverChapterId ? "pending_photo_selection" : "not_selected" }, photo_manifest: [...chapterPhotos.values()].flat(), views: [
    { id: "chapters", label: "Главы", items: chapters.map(chapter => { const chapterId = chapter.id || slugify(chapter.title); return { id: chapterId, title: chapter.title, description: chapter.description || "", href: chapter.href || `chapters/${chapterId}.html` }; }) },
    { id: "themes", label: "По темам", items: grouped("themes", "theme") },
    { id: "places", label: "По местам", items: grouped("places", "place") }
  ] };
  await fs.mkdir(path.join(baseDirectory, `data/${id}`), { recursive: true });
  await fs.mkdir(path.join(baseDirectory, `trips/${id}`), { recursive: true });
  await fs.mkdir(path.join(baseDirectory, `trips/${id}/chapters`), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  await fs.writeFile(path.join(baseDirectory, `data/${id}/trip.json`), `${JSON.stringify(tripData, null, 2)}\n`);
  await fs.writeFile(path.join(baseDirectory, `trips/${id}/index.html`), tripPage({ ...trip, coverUrl: trip.cover_url }));
  for (const chapter of chapters) {
    const chapterId = chapter.id || slugify(chapter.title);
    await fs.writeFile(path.join(baseDirectory, `trips/${id}/chapters/${chapterId}.html`), chapterPage({ trip, chapter, chapterId, photos: chapterPhotos.get(chapterId) || [] }));
  }
  return trip;
}

export function chapterPage({ trip, chapter, chapterId, photos = [] }) {
  const publishedPhotos = photos.filter(photo => photo.url);
  const gallery = publishedPhotos.length ? `<div class="gallery">${publishedPhotos.map(photo => `<figure><img src="${escapeHtml(photo.url)}" alt="" loading="lazy" decoding="async"><figcaption>${escapeHtml(photo.name)}</figcaption></figure>`).join("")}</div>` : `<div class="note">Фотографии пока не добавлены.</div>`;
  return `<!doctype html>\n<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(chapter.title)} · ${escapeHtml(trip.title)}</title><link rel="stylesheet" href="../../../style.css"><style>body{margin:0;background:#f4eee4;color:#251f19}main{max-width:1100px;margin:auto;padding:28px 18px 70px}a{color:inherit}.back{display:inline-block;margin-bottom:42px}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:11px;color:#8c684b}h1{font:300 clamp(48px,11vw,88px)/.92 Georgia,serif;letter-spacing:-.05em;margin:10px 0 22px}p{font:20px/1.45 Georgia,serif;max-width:820px}.gallery{columns:1;column-gap:14px;margin-top:38px}.gallery figure{break-inside:avoid;margin:0 0 14px}.gallery img{display:block;width:100%;height:auto;border-radius:16px}.gallery figcaption{padding:6px 4px;color:#665b50;font:11px/1.3 Inter,system-ui,sans-serif}.note{margin-top:44px;padding:18px;border:1px dashed #a89987;border-radius:18px;color:#665b50}@media(min-width:650px){.gallery{columns:2}}@media(min-width:980px){.gallery{columns:3}}</style></head><body><main><a class="back" href="../index.html">← ${escapeHtml(trip.title)}</a><div class="eyebrow">Черновик главы · ${escapeHtml(chapterId)}</div><h1>${escapeHtml(chapter.title)}</h1><p>${escapeHtml(chapter.description || "")}</p>${gallery}</main></body></html>`;
}

function slugify(value) {
  const letters = {а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ы:"y",э:"e",ю:"yu",я:"ya",ь:"",ъ:""};
  const transliterated = String(value || "item").toLowerCase().split("").map(character => letters[character] ?? character).join("");
  return transliterated.normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

export async function createTripFromRequest(requestPath, baseDirectory = root) {
  const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
  if (request.type !== "new_trip_request" || !request.trip) throw new Error("Файл не является заявкой из авторской мастерской");
  return createTrip({ ...request.trip, cover: request.trip.cover_url || "", status: request.trip.status || "hidden", chapters: request.chapters || [], replace: true }, baseDirectory);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = readArguments(process.argv.slice(2));
    const trip = arguments_.request ? await createTripFromRequest(path.resolve(arguments_.request)) : await createTrip(arguments_);
    console.log(`Создано путешествие «${trip.title}»:`);
    console.log(`  страница: ${trip.public_path}index.html`);
    console.log(`  данные: ${trip.data_path}/trip.json`);
  } catch (error) {
    console.error(`Ошибка: ${error.message}`);
    process.exitCode = 1;
  }
}
