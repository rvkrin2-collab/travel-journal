const params = new URLSearchParams(location.search);
const safe = value => String(value || "").toLowerCase().replace(/[^a-z0-9-]/g, "");
const trip = safe(params.get("trip"));
const root = document.querySelector("#chapters-status");
const title = document.querySelector("#title");
const summary = document.querySelector("#summary");
const escapeHtml = value => String(value || "").replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
async function get(path) { const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" }); return response.ok ? response.json() : null; }
async function refresh() {
  if (!trip) { title.textContent = "Не указан идентификатор путешествия"; return; }
  const tripData = await get(`data/${trip}/trip.json`);
  if (!tripData) { title.textContent = "Заявка принята"; summary.textContent = "GitHub Actions ещё создаёт черновик. Проверим снова через несколько секунд."; root.innerHTML = "<p>Подготовка фотоинвентаря…</p>"; return; }
  title.textContent = trip;
  const chapters = tripData.views?.find(view => ["chapters", "days"].includes(view.id))?.items || [];
  const states = await Promise.all(chapters.map(async chapter => {
    const base = `data/${trip}/${chapter.id}`;
    const [photos, analysis, ai] = await Promise.all([get(`${base}-photos.json`), get(`${base}-analysis.json`), get(`${base}-ai-review.json`)]);
    const ready = Boolean(photos && analysis && ai && photos.photos_fingerprint === analysis.photos_fingerprint && photos.photos_fingerprint === ai.photos_fingerprint);
    return { chapter, photos, analysis, ai, ready };
  }));
  const readyCount = states.filter(state => state.ready).length;
  summary.textContent = readyCount === states.length && states.length ? "Предварительный анализ готов. Откройте редакторы и утвердите фотографии." : `Готово редакторов: ${readyCount} из ${states.length}. Страница обновится автоматически.`;
  root.innerHTML = `<div class="panel-title"><b>✓</b><div><h2>Главы</h2><p>AI-отбор является только предложением.</p></div></div>${states.map(({ chapter, photos, analysis, ai, ready }) => `<article class="chapter"><div class="chapter-head"><strong>${escapeHtml(chapter.title)}</strong><span>${ready ? "Готово" : "Обрабатывается"}</span></div><p>${photos ? `${photos.photo_count ?? photos.items?.length ?? 0} фотографий зарегистрировано` : "Создаём список фотографий"} · ${analysis ? "анализ готов" : "анализ ожидается"} · ${ai ? "отбор готов" : "отбор ожидается"}</p>${ready ? `<a class="primary status-link" href="editor.html?trip=${trip}&chapter=${chapter.id}">Открыть редактор</a>` : ""}</article>`).join("")}`;
}
document.querySelector("#refresh").onclick = refresh;
refresh(); setInterval(refresh, 15000);
