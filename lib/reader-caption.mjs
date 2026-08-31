const EDITORIAL_META_PATTERNS = [
  /(?:^|\s)кадр(?:а|е|ом|ы|ов)?(?:\s|[.,!?;:]|$)/iu,
  /(?:монтаж|раскадровк|сториборд|storyboard)\w*/iu,
  /(?:визуальн\w*\s+)?(?:серия|функци|ритм)\w*/iu,
  /(?:кульминаци|переход|финал|блок)\w*/iu,
  /(?:основн\w*\s+)?(?:рассказ|публикаци)\w*/iu,
  /(?:нужен|нужна|нужно)\s+(?:здесь|для)/iu
];

const RISKY_STEMS = [
  "аркти", "тундр", "север", "южн", "восточ", "западн", "истор", "древн", "тради",
  "суров", "безлю", "опас", "посел", "рыбац", "турис", "военн", "забро", "разру"
];

const normalize = value => String(value || "").toLowerCase().replace(/ё/g, "е");

function introducesUnsupportedClaims(value, groundedLabel) {
  const text = normalize(value);
  const source = normalize(groundedLabel);
  if (RISKY_STEMS.some(stem => text.includes(stem) && !source.includes(stem))) return true;
  const sourceWords = new Set(source.match(/[а-яa-z-]{3,}/g) || []);
  const namedWords = String(value || "").match(/[А-ЯЁ][А-Яа-яЁё-]{2,}/g) || [];
  return namedWords.slice(1).some(word => !sourceWords.has(normalize(word)));
}

export function readsLikeEditorialNote(value) {
  const text = String(value || "").trim();
  return Boolean(text && EDITORIAL_META_PATTERNS.some(pattern => pattern.test(text)));
}

export function finishReaderSentence(value) {
  const text = String(value || "").trim().replace(/[.!?]+$/g, "");
  return text ? `${text}.` : "";
}

export function readerCaptionSeed(observed, fallback = "") {
  const groundedLabel = String(fallback || observed?.observation_label || "").trim();
  const candidates = [observed?.caption_seed, observed?.visual_summary, groundedLabel, observed?.observation_label];
  const value = candidates.map(item => String(item || "").replace(/\s+/g, " ").trim())
    .find(item => item && !readsLikeEditorialNote(item) && !introducesUnsupportedClaims(item, groundedLabel));
  return finishReaderSentence((value || "").slice(0, 420));
}

export function safeReaderCaption({ generated, note, label }) {
  if (generated && !readsLikeEditorialNote(generated)) return finishReaderSentence(generated);
  if (note && !readsLikeEditorialNote(note)) return finishReaderSentence(note);
  return finishReaderSentence(label);
}
