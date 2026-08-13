const tabs = document.querySelector("#tabs");
const content = document.querySelector("#content");
const tripId = document.body.dataset.trip;

function element(tag, options = {}) {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text) node.textContent = options.text;
  if (options.href) node.href = options.href;
  return node;
}

function renderCard(item) {
  const card = element("article", { className: "card" });
  card.append(element("h3", { text: item.title }), element("p", { text: item.description || "" }));
  const actions = element("div", { className: "card-actions" });
  if (item.href) actions.append(element("a", { text: "Открыть главу →", href: item.href }));
  if (item.photo_source_url) {
    const source = element("a", { text: "Смотреть фотографии ↗", href: item.photo_source_url });
    source.target = "_blank";
    source.rel = "noopener noreferrer";
    actions.append(source);
  }
  if (actions.children.length) card.append(actions);
  return card;
}

function render(view, selectedIndex) {
  [...tabs.children].forEach((button, index) => button.setAttribute("aria-selected", String(index === selectedIndex)));
  content.replaceChildren();
  if (!view.items.length) {
    content.append(element("div", { className: "empty", text: "В этом разделе пока нет материалов." }));
    return;
  }
  const grid = element("div", { className: "grid" });
  view.items.forEach(item => grid.append(renderCard(item)));
  content.append(grid);
}

fetch(`../../data/${encodeURIComponent(tripId)}/trip.json`)
  .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
  .then(trip => {
    trip.views.forEach((view, index) => {
      const button = element("button", { text: view.label });
      button.type = "button";
      button.setAttribute("aria-selected", "false");
      button.addEventListener("click", () => render(view, index));
      tabs.append(button);
    });
    render(trip.views[0], 0);
  })
  .catch(error => content.append(element("div", { className: "empty", text: `Не удалось загрузить путешествие: ${error.message}` })));
