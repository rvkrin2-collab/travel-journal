const dataPath = document.body.dataset.tripData;
const root = document.querySelector("#journal-content");
const el = (tag, options = {}) => Object.assign(document.createElement(tag), options);
const encodedPhotoKey = photo => photo?.key?.split("/").map(encodeURIComponent).join("/");
const photoUrl = (photo, width = 1400) => encodedPhotoKey(photo) ? `https://upload.owntravel.ru/thumbnail/${encodedPhotoKey(photo)}?w=${width}` : photo?.url || "";
const responsivePhoto = (photo, { width = 1400, sizes = "100vw", eager = false, alt = "" } = {}) => {
  const image = el("img", { src: photoUrl(photo, width), alt, loading: eager ? "eager" : "lazy", decoding: "async" });
  if (eager) image.fetchPriority = "high";
  if (encodedPhotoKey(photo)) {
    image.srcset = [480, 800, 1200, 1600].map(value => `${photoUrl(photo, value)} ${value}w`).join(", ");
    image.sizes = sizes;
  }
  if (photo?.width > 0 && photo?.height > 0) { image.width = photo.width; image.height = photo.height; }
  return image;
};

function renderTrip(data) {
  const trip = data.meta;
  document.title = `${trip.title} · Журнал путешествий`;
  root.append(el("p", { className: "journal-kicker", textContent: trip.period }), el("h1", { textContent: trip.title }), el("p", { className: "journal-lead", textContent: trip.description }));
  if (trip.route?.length) root.append(el("p", { className: "journal-route", textContent: `Маршрут: ${trip.route.join(" → ")}` }));
  const list = el("section", { className: "day-list" });
  const chapters = data.chapters || data.days || [];
  chapters.forEach(day => {
    const link = el("a", { className: "day-card", href: `${data.chapters ? "chapters" : "days"}/${day.id}.html` });
    if (day.hero?.url) link.append(responsivePhoto(day.hero, { width: 800, sizes: "(min-width: 720px) 50vw, 100vw", alt: day.title }));
    const copy = el("div");
    copy.append(el("small", { textContent: day.label }), el("h2", { textContent: day.title }), el("p", { textContent: day.summary }));
    link.append(copy); list.append(link);
  });
  root.append(list);
}

function renderDay(data, id) {
  const chapters = data.chapters || data.days || [];
  const day = chapters.find(item => item.id === id);
  if (!day) throw new Error("Глава не найдена");
  document.title = `${day.title} · ${data.meta.title}`;
  if (data.editorial.status !== "approved") root.append(el("div", { className: "draft-banner", textContent: "Редакторский черновик. Эта версия не опубликована и требует визуального отбора и прямого утверждения автора." }));
  root.append(el("p", { className: "journal-kicker", textContent: day.label }), el("h1", { textContent: day.title }), el("p", { className: "journal-lead", textContent: day.summary }));
  if (day.route?.length) root.append(el("p", { className: "journal-route", textContent: `Маршрут: ${day.route.join(" → ")}` }));
  if (day.hero?.url) { const hero = responsivePhoto(day.hero, { width: 1600, sizes: "100vw", eager: true, alt: day.title }); hero.className = "story-hero"; root.append(hero); }
  const scenes = day.scenes || day.story || [];
  scenes.forEach(scene => { const section = el("section", { className: "story-frame" }); const photos = scene.photos || (scene.photo ? [scene.photo] : []); photos.forEach(photo => { if (photo?.url) section.append(responsivePhoto(photo, { sizes: "(min-width: 1180px) 1144px, 100vw", alt: scene.title || day.title })); }); if (scene.text) section.append(el("p", { textContent: scene.text })); root.append(section); });
  if (day.backstage?.length) { const section = el("section", { className: "backstage" }); section.append(el("p", { className: "journal-kicker", textContent: "За кадром" }), el("h2", { textContent: "Ещё несколько сцен" })); const grid = el("div", { className: "backstage-grid" }); day.backstage.forEach(photo => grid.append(responsivePhoto(photo, { width: 480, sizes: "(min-width: 720px) 25vw, 50vw", alt: "За кадром" }))); section.append(grid); root.append(section); }
  if (data.editorial.status === "awaiting_visual_review") root.append(el("div", { className: "draft-banner", textContent: "Кадры намеренно не показаны на странице дня: сначала требуется визуальная проверка принадлежности, локаций и последовательности. Имена файлов и даты не используются как основание для истории." }));
  const index = chapters.indexOf(day); const nav = el("nav", { className: "day-nav" });
  if (index) nav.append(el("a", { href: `${chapters[index - 1].id}.html`, textContent: `← ${chapters[index - 1].title}` })); else nav.append(el("span"));
  nav.append(el("a", { href: "../index.html", textContent: "Всё путешествие" }));
  if (index < chapters.length - 1) nav.append(el("a", { href: `${chapters[index + 1].id}.html`, textContent: `${chapters[index + 1].title} →` }));
  root.append(nav);
}

fetch(dataPath, { cache: "no-store" }).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => { const chapter = document.body.dataset.chapter || document.body.dataset.day; chapter ? renderDay(data, chapter) : renderTrip(data); }).catch(error => root.append(el("p", { className: "draft-banner", textContent: `Не удалось открыть путешествие: ${error.message}` })));
