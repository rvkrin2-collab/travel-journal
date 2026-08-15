const dataPath = document.body.dataset.tripData;
const root = document.querySelector("#journal-content");
const el = (tag, options = {}) => Object.assign(document.createElement(tag), options);
const photoUrl = (photo, width = 1400) => photo?.key ? `https://upload.owntravel.ru/thumbnail/${photo.key.split("/").map(encodeURIComponent).join("/")}?w=${width}` : photo?.url || "";

function renderTrip(data) {
  const trip = data.meta;
  document.title = `${trip.title} · Журнал путешествий`;
  root.append(el("p", { className: "journal-kicker", textContent: trip.period }), el("h1", { textContent: trip.title }), el("p", { className: "journal-lead", textContent: trip.description }));
  if (trip.route?.length) root.append(el("p", { className: "journal-route", textContent: `Маршрут: ${trip.route.join(" → ")}` }));
  const list = el("section", { className: "day-list" });
  const chapters = data.chapters || data.days || [];
  chapters.forEach(day => {
    const link = el("a", { className: "day-card", href: `${data.chapters ? "chapters" : "days"}/${day.id}.html` });
    if (day.hero?.url) link.append(el("img", { src: photoUrl(day.hero, 720), alt: "", loading: "lazy" }));
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
  if (day.hero?.url) root.append(el("img", { className: "story-hero", src: photoUrl(day.hero, 1600), alt: "" }));
  const scenes = day.scenes || day.story || [];
  scenes.forEach(scene => { const section = el("section", { className: "story-frame" }); const photos = scene.photos || (scene.photo ? [scene.photo] : []); photos.forEach(photo => { if (photo?.url) section.append(el("img", { src: photoUrl(photo), alt: "", loading: "lazy" })); }); if (scene.text) section.append(el("p", { textContent: scene.text })); root.append(section); });
  if (day.backstage?.length) { const section = el("section", { className: "backstage" }); section.append(el("p", { className: "journal-kicker", textContent: "За кадром" }), el("h2", { textContent: "Ещё несколько сцен" })); const grid = el("div", { className: "backstage-grid" }); day.backstage.forEach(photo => grid.append(el("img", { src: photoUrl(photo, 720), alt: "", loading: "lazy" }))); section.append(grid); root.append(section); }
  if (data.editorial.status === "awaiting_visual_review") root.append(el("div", { className: "draft-banner", textContent: "Кадры намеренно не показаны на странице дня: сначала требуется визуальная проверка принадлежности, локаций и последовательности. Имена файлов и даты не используются как основание для истории." }));
  const index = chapters.indexOf(day); const nav = el("nav", { className: "day-nav" });
  if (index) nav.append(el("a", { href: `${chapters[index - 1].id}.html`, textContent: `← ${chapters[index - 1].title}` })); else nav.append(el("span"));
  nav.append(el("a", { href: "../index.html", textContent: "Всё путешествие" }));
  if (index < chapters.length - 1) nav.append(el("a", { href: `${chapters[index + 1].id}.html`, textContent: `${chapters[index + 1].title} →` }));
  root.append(nav);
}

fetch(dataPath, { cache: "no-store" }).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => { const chapter = document.body.dataset.chapter || document.body.dataset.day; chapter ? renderDay(data, chapter) : renderTrip(data); }).catch(error => root.append(el("p", { className: "draft-banner", textContent: `Не удалось открыть путешествие: ${error.message}` })));
