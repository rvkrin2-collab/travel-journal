const headingPattern = /^\s*(?:\*\*)?\s*глава\s+\d+\s*[—–:-]\s*(.+?)(?:\*\*)?\s*$/iu;
const fieldPattern = /^\s*(темы|места)\s*:\s*(.+)$/iu;

function clean(value) {
  return String(value || "").trim().replace(/^`|`$/g, "").trim();
}

function list(value) {
  return clean(value).split(",").map(clean).filter(Boolean);
}

export function parseChapters(text) {
  const chapters = [];
  let current = null;
  for (const rawLine of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    const heading = line.match(headingPattern);
    if (heading) {
      current = { title: clean(heading[1]), descriptionLines: [], themes: [], places: [] };
      chapters.push(current);
      continue;
    }
    if (!current || !line) continue;
    const field = line.match(fieldPattern);
    if (field) current[field[1].toLocaleLowerCase("ru-RU") === "темы" ? "themes" : "places"] = list(field[2]);
    else current.descriptionLines.push(clean(line.replace(/^[-*]\s+/, "")));
  }
  return chapters.filter(chapter => chapter.title).map(chapter => ({
    title: chapter.title,
    description: chapter.descriptionLines.join(" ").trim(),
    themes: chapter.themes.join(", "),
    places: chapter.places.join(", ")
  }));
}
