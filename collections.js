const collectionsRoot = document.querySelector("#collections");
if (collectionsRoot) {
  const esc = value => String(value || "").replace(/[&<>\"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"})[char]);
  fetch("../../data/kyrgyzstan-2026/collections.json").then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); }).then(data => {
    collectionsRoot.innerHTML = data.views.map(view => `<section class="collection-view"><span class="section-label">${esc(view.label)}</span><div class="collection-grid">${view.items.map(item => `<article class="collection-card"><img src="${esc(item.cover_url)}" alt=""><div><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p><nav>${item.links.map(link => `<a href="${esc(link.href)}">${esc(link.label)}</a>`).join("")}</nav></div></article>`).join("")}</div></section>`).join("");
  }).catch(error => { collectionsRoot.textContent = `Не удалось загрузить подборки: ${error.message}`; });
}
