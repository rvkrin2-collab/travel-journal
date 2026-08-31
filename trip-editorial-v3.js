const dataPath = document.body.dataset.tripData;
const root = document.querySelector("#journal-content");
const el = (tag, options = {}) => Object.assign(document.createElement(tag), options);
const photoKey = photo => photo?.key?.split("/").map(encodeURIComponent).join("/");
const photoUrl = (photo, width = 1400) => photoKey(photo) ? `https://api.owntravel.ru/thumbnail/${photoKey(photo)}?w=${width}` : photo?.url || "";
const responsivePhoto = (photo, { width = 1400, sizes = "100vw", eager = false, alt = "", className = "" } = {}) => {
  const image = el("img", { src: photoUrl(photo, width), alt, loading: eager ? "eager" : "lazy", decoding: "async", className });
  if (eager) image.fetchPriority = "high";
  if (photoKey(photo)) {
    image.srcset = [480, 800, 1200, 1600].map(value => `${photoUrl(photo, value)} ${value}w`).join(", ");
    image.sizes = sizes;
  }
  if (photo?.width > 0 && photo?.height > 0) { image.width = photo.width; image.height = photo.height; }
  return image;
};
const chaptersOf = data => data.chapters || data.days || [];

function appendCoverPhoto(container, photo, alt) {
  if (!photo?.url && !photo?.key) {
    container.classList.add("cover--fallback");
    return;
  }
  container.append(responsivePhoto(photo, { width: 2000, sizes: "100vw", eager: true, alt, className: "cover__media" }));
}

function renderTrip(data) {
  const trip = data.meta || {};
  const chapters = chaptersOf(data);
  document.title = `${trip.title || "Путешествие"} · Журнал путешествий`;
  const back = el("a", { className: "back-link", href: "../../index.html", textContent: "← Все путешествия" });
  document.body.prepend(back);
  const coverPhoto = trip.cover || chapters[0]?.hero;
  const cover = el("header", { className: "cover" });
  appendCoverPhoto(cover, coverPhoto, trip.title || "Обложка путешествия");
  const inner = el("div", { className: "cover__inner" });
  inner.append(el("small", { textContent: data.editorial?.status === "approved" ? "Путешествие" : "Черновик путешествия" }), el("h1", { textContent: trip.title || "Путешествие" }), el("p", { textContent: trip.description || trip.subtitle || "" }));
  cover.append(inner); root.append(cover);

  const main = el("main", { className: "trip-main" });
  const lead = el("section", { className: "lead" });
  lead.append(el("span", { className: "section-label", textContent: "Журнал путешествия" }), el("h2", { textContent: trip.subtitle || trip.title || "" }), el("p", { textContent: chapters.length ? `${chapters.length} главы, собранные в одну последовательность.` : "" }));
  main.append(lead);
  const list = el("section", { className: "chapters" });
  chapters.forEach((chapter, index) => {
    const link = el("a", { className: "chapter-card", href: `chapters/${chapter.id}.html` });
    if (chapter.hero) link.append(responsivePhoto(chapter.hero, { width: index === 0 ? 1600 : 1000, sizes: index === 0 ? "(min-width:840px) 58vw,100vw" : "(min-width:840px) 33vw,100vw", alt: chapter.title }));
    const copy = el("div", { className: "chapter-card__text" });
    copy.append(el("span", { className: "section-label", textContent: chapter.label || "Глава" }), el("h3", { textContent: chapter.title || chapter.id }), el("p", { textContent: chapter.summary || "" }));
    link.append(copy); list.append(link);
  });
  main.append(list); root.append(main);
}

function renderDay(data, id) {
  const chapters = chaptersOf(data);
  const chapter = chapters.find(item => item.id === id);
  if (!chapter) throw new Error("Глава не найдена");
  document.title = `${chapter.title} · ${data.meta?.title || "Журнал путешествий"}`;
  const back = el("a", { className: "back-link", href: "../index.html", textContent: `← ${data.meta?.title || "Всё путешествие"}` });
  document.body.prepend(back);

  const hero = el("header", { className: "chapter-hero" });
  appendCoverPhoto(hero, chapter.hero, chapter.title || "Обложка главы");
  const heroInner = el("div", { className: "chapter-hero__inner" });
  heroInner.append(el("small", { textContent: chapter.label || "Глава" }), el("h1", { textContent: chapter.title || id }), el("p", { textContent: chapter.summary || "" }));
  hero.append(heroInner); root.append(hero);

  const main = el("main", { className: "chapter-main" });
  const scenes = chapter.scenes || chapter.story || [];
  scenes.forEach((scene, index) => {
    const section = el("section", { className: "scene" });
    const copy = el("div", { className: "scene-copy" });
    copy.append(
      el("small", { className: "scene-number", textContent: String(index + 1).padStart(2, "0") }),
      el("h2", { className: "scene-title", textContent: scene.title || "Без названия" }),
      el("p", { className: "scene-caption", textContent: scene.text || "" })
    );
    section.append(copy);
    const photo = (scene.photos || (scene.photo ? [scene.photo] : []))[0];
    if (photo) section.append(responsivePhoto(photo, { width: 1600, sizes: "(min-width:1200px) 1200px,100vw", alt: scene.title || chapter.title, className: "scene-photo" }));
    main.append(section);
  });

  if (chapter.backstage?.length) {
    const backstage = el("section", { className: "backstage" });
    backstage.append(el("span", { className: "section-label", textContent: "За кадром" }), el("h2", { textContent: "Ещё несколько кадров" }));
    const grid = el("div", { className: "backstage-grid" });
    chapter.backstage.forEach(photo => grid.append(responsivePhoto(photo, { width: 600, sizes: "(min-width:840px) 25vw,50vw", alt: "За кадром" })));
    backstage.append(grid); main.append(backstage);
  }

  const nav = el("nav", { className: "chapter-nav", ariaLabel: "Навигация по главам" });
  const index = chapters.indexOf(chapter);
  if (index > 0) { const a = el("a", { href: `${chapters[index - 1].id}.html` }); a.append(el("span", { textContent: "← Предыдущая глава" }), el("strong", { textContent: chapters[index - 1].title })); nav.append(a); } else nav.append(el("span"));
  const all = el("a", { href: "../index.html" }); all.append(el("span", { textContent: "Путешествие" }), el("strong", { textContent: data.meta?.title || "Все главы" })); nav.append(all);
  if (index < chapters.length - 1) { const a = el("a", { href: `${chapters[index + 1].id}.html` }); a.append(el("span", { textContent: "Следующая глава →" }), el("strong", { textContent: chapters[index + 1].title })); nav.append(a); }
  main.append(nav); root.append(main);
}

fetch(dataPath, { cache: "no-store" })
  .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then(data => { const chapter = document.body.dataset.chapter || document.body.dataset.day; chapter ? renderDay(data, chapter) : renderTrip(data); })
  .catch(error => root.append(el("p", { className: "empty", textContent: `Не удалось открыть путешествие: ${error.message}` })));
