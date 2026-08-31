import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function pageTitle(baseDirectory, id) {
  try {
    const html = await fs.readFile(path.join(baseDirectory, "trips", id, "index.html"), "utf8");
    return (html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] || html.match(/<title>([^<·]+)/i)?.[1] || "").trim();
  } catch (error) { if (error.code === "ENOENT") return ""; throw error; }
}

async function isLegacy(baseDirectory, id) {
  try {
    const html = await fs.readFile(path.join(baseDirectory, "trips", id, "index.html"), "utf8");
    return html.includes("legacy-trip-redirect.js");
  } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export async function buildAdminTrips(baseDirectory = root) {
  const registry = await readJson(path.join(baseDirectory, "data", "trips.json"));
  const entries = await fs.readdir(path.join(baseDirectory, "data"), { withFileTypes: true });
  const ids = new Set((registry?.trips || []).map(item => item.id));
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue;
    if (await readJson(path.join(baseDirectory, "data", entry.name, "trip.json"))) ids.add(entry.name);
  }

  const trips = [];
  for (const id of [...ids].sort()) {
    const registered = registry?.trips?.find(item => item.id === id) || null;
    const tripData = await readJson(path.join(baseDirectory, "data", id, "trip.json"));
    const chapters = tripData?.views?.find(view => ["chapters", "days"].includes(view.id))?.items || [];
    const redirects = await isLegacy(baseDirectory, id);
    const legacy = !registered && redirects;
    const editorialStatus = tripData?.editorial_status || "";
    trips.push({
      id,
      title: registered?.title || tripData?.title || await pageTitle(baseDirectory, id) || id,
      subtitle: registered?.subtitle || tripData?.subtitle || "",
      period: registered?.period || tripData?.period || "",
      data_path: registered?.data_path || `data/${id}`,
      public_path: registered?.public_path || `trips/${id}/`,
      registry_status: registered?.status || "unregistered",
      editorial_status: editorialStatus,
      chapter_count: chapters.length || Number(registered?.total_days) || 0,
      archived: legacy || (registered?.status === "hidden" && editorialStatus === "published"),
      legacy,
      redirects
    });
  }

  const manifest = { schema_version: 1, trips };
  await fs.writeFile(path.join(baseDirectory, "data", "admin-trips.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildAdminTrips().then(result => console.log(`Административный список: ${result.trips.length} путешествий`)).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
