const HEADING = /^\s*Глава\s+\d+\s*[—–-]\s*(.+?)\s*$/i;
const FIELD = /^\s*(Темы|Места)\s*:\s*(.*?)\s*$/i;

export function parseChapterDescription(value) {
  const chapters = [];
  let chapter = null;
  let description = [];

  const finish = () => {
    if (!chapter) return;
    chapter.description = description.join("\n").trim();
    chapters.push(chapter);
  };

  for (const line of String(value || "").replace(/\r\n?/g, "\n").split("\n")) {
    const heading = line.match(HEADING);
    if (heading) {
      finish();
      chapter = { title: heading[1].trim(), description: "", themes: "", places: "" };
      description = [];
      continue;
    }
    if (!chapter) continue;
    const field = line.match(FIELD);
    if (field) {
      chapter[field[1].toLowerCase() === "темы" ? "themes" : "places"] = field[2].trim();
    } else {
      description.push(line);
    }
  }
  finish();
  return chapters;
}
