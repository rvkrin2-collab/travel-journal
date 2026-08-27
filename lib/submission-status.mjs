export const CHAPTER_STAGES = ["Фотографии получены", "Фотографии проанализированы", "ИИ-отбор подготовлен", "Отбор утверждён автором", "Preview собрано", "Preview утверждено"];

const timestamp = value => {
  const parsed = Date.parse(value?.updated_at || value?.generated_at || value?.approved_at || value?.created_at || "");
  return Number.isFinite(parsed) ? parsed : 0;
};

export function chapterStatus({ photos, analysis, ai, author, storyboard, approval }, now = Date.now()) {
  const fingerprint = photos?.photos_fingerprint || "";
  const matches = value => Boolean(fingerprint && value?.photos_fingerprint === fingerprint);
  const completed = [Boolean(photos), matches(analysis), matches(ai), matches(author), matches(storyboard), matches(approval) && approval.status === "preview_approved"];
  const done = completed.filter(Boolean).length;
  const nextIndex = completed.findIndex(value => !value);
  const lastActivity = Math.max(0, ...[photos, analysis, ai, author, storyboard, approval].map(timestamp));
  const waitingForAuthor = nextIndex === 3 || nextIndex === 5;
  const waitingForSystem = nextIndex === 0 || nextIndex === 1 || nextIndex === 2 || nextIndex === 4;
  const stale = Boolean(waitingForSystem && lastActivity && now - lastActivity > 30 * 60 * 1000);
  let kind = "working", label = nextIndex < 0 ? "Глава полностью утверждена" : `Сейчас: ${CHAPTER_STAGES[nextIndex]}`, instruction = "Страница проверит результат автоматически.", action = "";
  if (nextIndex < 0) { kind = "done"; instruction = "По этой главе ничего больше делать не нужно."; }
  else if (waitingForAuthor) { kind = "action"; instruction = nextIndex === 3 ? "Откройте редактор, выберите фотографии и утвердите отбор." : "Откройте preview, проверьте главу и утвердите её."; action = nextIndex === 3 ? "editor" : "preview"; }
  else if (stale) { kind = "stalled"; label = "Обработка остановилась"; instruction = "Новых результатов нет больше 30 минут. Эта заявка требует повторного запуска из авторской мастерской."; action = "restart"; }
  return { completed, done, total: CHAPTER_STAGES.length, percent: Math.round(done / CHAPTER_STAGES.length * 100), nextIndex, lastActivity, kind, label, instruction, action };
}

export function overallProgress(states, published = false) {
  if (!states.length) return { percent: 0, done: 0, total: 0 };
  const done = states.reduce((sum, state) => sum + state.done, 0) + (published ? 1 : 0);
  const total = states.length * CHAPTER_STAGES.length + 1;
  return { percent: Math.round(done / total * 100), done, total };
}
