const dataPath = document.body.dataset.tripData;
const root = document.querySelector("#journal-content");
const el = (tag, options = {}) => Object.assign(document.createElement(tag), options);

function renderTrip(data) {
  const trip = data.meta;
  document.title = `${trip.title} · Журнал путешествий`;
  root.append(el("p", { className: "journal-kicker", textContent: trip.period }), el("h1", { textContent: trip.title }), el("p", { className: "journal-lead", textContent: trip.description }));
  if (trip.route?.length) root.append(el("p", { className: "journal-route", textContent: `Маршрут: ${trip.route.join(" → ")}` }));
  const list = el("section", { className: "day-list" });
  data.days.forEach(day => {
    const link = el("a", { className: "day-card", href: `days/${day.id}.html` });
    if (day.hero?.url) link.append(el("img", { src: day.hero.url, alt: "", loading: "lazy" }));
    const copy = el("div");
    copy.append(el("small", { textContent: day.label }), el("h2", { textContent: day.title }), el("p", { textContent: day.summary }));
    link.append(copy); list.append(link);
  });
  root.append(list);
}

function renderDay(data, id) {
  const day = data.days.find(item => item.id === id);
  if (!day) throw new Error("Глава не найдена");
  document.title = `${day.title} · ${data.meta.title}`;
  if (data.editorial.status !== "approved") root.append(el("div", { className: "draft-banner", textContent: "Редакторский черновик. Эта версия не опубликована и требует визуального отбора и прямого утверждения автора." }));
  root.append(el("p", { className: "journal-kicker", textContent: day.label }), el("h1", { textContent: day.title }), el("p", { className: "journal-lead", textContent: day.summary }));
  if (day.route?.length) root.append(el("p", { className: "journal-route", textContent: `Маршрут: ${day.route.join(" → ")}` }));
  if (day.hero?.url) root.append(el("img", { className: "story-hero", src: day.hero.url, alt: "" }));
  (day.story || []).forEach(scene => { const section = el("section", { className: "story-frame" }); if (scene.photo?.url) section.append(el("img", { src: scene.photo.url, alt: "", loading: "lazy" })); if (scene.text) section.append(el("p", { textContent: scene.text })); root.append(section); });
  if (day.backstage?.length) { const section = el("section", { className: "backstage" }); section.append(el("p", { className: "journal-kicker", textContent: "За кадром" }), el("h2", { textContent: "Ещё несколько сцен" })); const grid = el("div", { className: "backstage-grid" }); day.backstage.forEach(photo => grid.append(el("img", { src: photo.url, alt: "", loading: "lazy" }))); section.append(grid); root.append(section); }
  if (data.editorial.status === "awaiting_visual_review") root.append(el("div", { className: "draft-banner", textContent: "Кадры намеренно не показаны на странице дня: сначала требуется визуальная проверка принадлежности, локаций и последовательности. Имена файлов и даты не используются как основание для истории." }));
  const index = data.days.indexOf(day); const nav = el("nav", { className: "day-nav" });
  if (index) nav.append(el("a", { href: `${data.days[index - 1].id}.html`, textContent: `← ${data.days[index - 1].title}` })); else nav.append(el("span"));
  nav.append(el("a", { href: "../index.html", textContent: "Всё путешествие" }));
  if (index < data.days.length - 1) nav.append(el("a", { href: `${data.days[index + 1].id}.html`, textContent: `${data.days[index + 1].title} →` }));
  root.append(nav);
}

fetch(dataPath, { cache: "no-store" }).then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => document.body.dataset.day ? renderDay(data, document.body.dataset.day) : renderTrip(data)).catch(error => root.append(el("p", { className: "draft-banner", textContent: `Не удалось открыть черновик: ${error.message}` })));
