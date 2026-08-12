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

export function tripPage({ id, title, subtitle, period, description, coverUrl }) {
  const dataPath = `../../data/${id}/trip.json`;
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)} · Журнал путешествий</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="stylesheet" href="../../style.css">
  <style>body{margin:0;background:#f4eee4;color:#251f19;font:16px/1.45 Inter,system-ui,sans-serif}.back{display:inline-block;margin:20px;color:inherit}.cover{min-height:58svh;display:flex;align-items:end;padding:36px 20px;background:#263c34 center/cover;color:#fff8ec}.cover h1{font:300 clamp(48px,12vw,112px)/.9 Georgia,serif;letter-spacing:-.05em;margin:8px 0}.cover p{font:22px/1.3 Georgia,serif;max-width:760px}main{max-width:1100px;margin:auto;padding:48px 18px}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0}.tabs button{border:1px solid #cfc1ae;border-radius:999px;padding:10px 14px;background:#fff8ec;cursor:pointer}.tabs button[aria-selected=true]{background:#263c34;color:white}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}.card{padding:20px;background:#fff8ec;border-radius:18px}.card h3{font:30px/1 Georgia,serif;margin:0 0 10px}.card a{color:inherit}.empty{padding:22px;border:1px dashed #aa9c89;border-radius:18px}</style>
</head>
<body><a class="back" href="../../index.html">← Все путешествия</a><header class="cover"${coverUrl ? ` style="background-image:linear-gradient(0deg,rgba(0,0,0,.62),rgba(0,0,0,.08)),url('${escapeHtml(coverUrl)}')"` : ""}><div><small>${escapeHtml(period)}</small><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></header><main><p>${escapeHtml(description)}</p><div id="tabs" class="tabs" aria-label="Способы просмотра"></div><section id="content"></section></main><script>fetch('${dataPath}').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json()}).then(trip=>{const tabs=document.querySelector('#tabs'),content=document.querySelector('#content');function render(view,index){tabs.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-selected',i===index));content.innerHTML=view.items.length?'<div class="grid">'+view.items.map(item=>'<article class="card"><h3>'+item.title+'</h3><p>'+(item.description||'')+'</p>'+(item.href?'<a href="'+item.href+'">Открыть →</a>':'')+'</article>').join('')+'</div>':'<div class="empty">В этом разделе пока нет материалов. Добавьте их в <code>data/${id}/trip.json</code>.</div>'}trip.views.forEach((view,index)=>{const button=document.createElement('button');button.textContent=view.label;button.setAttribute('aria-selected','false');button.onclick=()=>render(view,index);tabs.append(button)});render(trip.views[0],0)}).catch(error=>document.querySelector('#content').textContent='Не удалось загрузить путешествие: '+error.message)</script></body></html>`;
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
    status: "active"
  };
  const registryPath = path.join(baseDirectory, "data/trips.json");
  const registry = JSON.parse(await fs.readFile(registryPath, "utf8"));
  if (registry.trips.some(item => item.id === id)) throw new Error(`Путешествие ${id} уже существует`);
  registry.trips.push(trip);
  const chapters = options.chapters || [];
  const grouped = (field, prefix) => [...new Set(chapters.flatMap(chapter => chapter[field] || []))].map(label => ({
    id: `${prefix}-${validateTripId(slugify(label))}`,
    title: label,
    description: `Материалы: ${chapters.filter(chapter => chapter[field]?.includes(label)).map(chapter => chapter.title).join(", ")}`
  }));
  const tripData = { schema_version: 1, trip: id, photo_sources: chapters.filter(chapter => chapter.photo_source_url).map(chapter => ({ chapter_id: chapter.id || slugify(chapter.title), url: chapter.photo_source_url })), photo_manifest: chapters.flatMap(chapter => chapter.photos || []), views: [
    { id: "chapters", label: "Главы", items: chapters.map(chapter => ({ id: chapter.id || slugify(chapter.title), title: chapter.title, description: chapter.description || "", href: chapter.href || "" })) },
    { id: "themes", label: "По темам", items: grouped("themes", "theme") },
    { id: "places", label: "По местам", items: grouped("places", "place") }
  ] };
  await fs.mkdir(path.join(baseDirectory, `data/${id}`), { recursive: true });
  await fs.mkdir(path.join(baseDirectory, `trips/${id}`), { recursive: true });
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
  await fs.writeFile(path.join(baseDirectory, `data/${id}/trip.json`), `${JSON.stringify(tripData, null, 2)}\n`);
  await fs.writeFile(path.join(baseDirectory, `trips/${id}/index.html`), tripPage({ ...trip, coverUrl: trip.cover_url }));
  return trip;
}

function slugify(value) {
  return String(value || "item").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

export async function createTripFromRequest(requestPath, baseDirectory = root) {
  const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
  if (request.type !== "new_trip_request" || !request.trip) throw new Error("Файл не является заявкой из авторской мастерской");
  return createTrip({ ...request.trip, cover: request.trip.cover_url || "", chapters: request.chapters || [] }, baseDirectory);
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
