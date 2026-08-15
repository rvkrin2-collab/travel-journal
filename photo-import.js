import { preselectPhotos, qualityScore } from "./lib/photo-quality.mjs";

const input = document.querySelector("#photos");
const grid = document.querySelector("#results");
const summary = document.querySelector("#summary");
const exportButton = document.querySelector("#export");
let report = null;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Не удалось прочитать ${file.name}`)); };
    image.src = url;
  });
}

function inspectPixels(data, width, height) {
  const luminance = new Float32Array(width * height);
  let sum = 0;
  for (let pixel = 0, offset = 0; pixel < luminance.length; pixel++, offset += 4) {
    const value = (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255;
    luminance[pixel] = value;
    sum += value;
  }
  const exposure = sum / luminance.length;
  let variance = 0;
  let edges = 0;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const index = y * width + x;
    variance += (luminance[index] - exposure) ** 2;
    edges += Math.abs(4 * luminance[index] - luminance[index - 1] - luminance[index + 1] - luminance[index - width] - luminance[index + width]);
  }
  const hash = [];
  const blockWidth = width / 9;
  const blockHeight = height / 8;
  const cells = [];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) cells.push(luminance[Math.floor((y + .5) * blockHeight) * width + Math.floor((x + .5) * blockWidth)]);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) hash.push(cells[y * 9 + x] < cells[y * 9 + x + 1] ? "1" : "0");
  return { exposure, contrast: Math.sqrt(variance / luminance.length), sharpness: edges / luminance.length * 1000, hash: hash.join("") };
}

async function analyze(file, index) {
  const image = await loadImage(file);
  const scale = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(9, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(8, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const metrics = inspectPixels(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  return { id: `${file.name}-${file.lastModified}`, name: file.name, size: file.size, width: image.naturalWidth, height: image.naturalHeight, index, ...metrics, score: qualityScore(metrics), preview: canvas.toDataURL("image/jpeg", .72) };
}

function renderItem(item) {
  const reason = item.status === "selected" ? "предварительно выбрано" : item.status === "duplicate" ? "похожий кадр" : "техническое качество";
  return `<article class="photo ${item.status}"><img src="${item.preview}" alt=""><div><strong>${item.name}</strong><span>${item.score}/100 · ${reason}</span></div></article>`;
}

input.addEventListener("change", async () => {
  const files = [...input.files].filter(file => file.type.startsWith("image/"));
  if (!files.length) return;
  summary.textContent = `Анализируем ${files.length} фото на этом устройстве…`;
  grid.innerHTML = "";
  const items = [];
  for (let index = 0; index < files.length; index++) {
    items.push(await analyze(files[index], index));
    summary.textContent = `Проверено ${index + 1} из ${files.length}…`;
  }
  const selection = preselectPhotos(items);
  report = { schema_version: 1, source: "device", generated_at: new Date().toISOString(), algorithm: "laplacian-exposure-dhash-v1", items: [...selection.selected, ...selection.rejected].sort((a, b) => a.index - b.index).map(({ preview, originalIndex, ...item }) => item) };
  grid.innerHTML = [...selection.selected, ...selection.rejected].sort((a, b) => a.index - b.index).map(renderItem).join("");
  summary.textContent = `Выбрано ${selection.selected.length} из ${files.length}. Всё обработано локально — фото никуда не отправлялись.`;
  exportButton.disabled = false;
});

exportButton.addEventListener("click", () => {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  link.download = `photo-selection-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
