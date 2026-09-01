import fs from "node:fs/promises";
import path from "node:path";
import { assertSamePhotoSet, inventoryItems, photoId, safeSlug } from "./lib/editorial-artifacts.mjs";
import { materializePublicPhotos, publicPhotoUrl } from "./lib/public-media.mjs";

const root = process.env.ROOT || ".";
const trip = safeSlug(process.env.TRIP, "trip");
const coverChapter = safeSlug(process.env.COVER_CHAPTER, "cover chapter");
const read = file => fs.readFile(path.join(root, file), "utf8").then(JSON.parse);
const write = (file, value) => fs.writeFile(path.join(root, file), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
const escapeHtml = value => String(value || "").replace(/[&<>\"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const publicHead = ({ title, description, canonical }) => `<title>${escapeHtml(title)}</title><meta name="description" content="${escapeHtml(description)}"><link rel="canonical" href="https://owntravel.ru${canonical}"><meta property="og:type" content="website"><meta property="og:locale" content="ru_RU"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="https://owntravel.ru${canonical}"><meta name="twitter:card" content="summary_large_image">`;
const appHead = `<meta name="theme-color" content="#263c34"><meta name="application-name" content="Журнал путешествий"><meta name="mobile-web-app-capable" content="yes"><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/png" href="/icons/icon-192.png"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`;
const appScripts = `<script src="/pwa.js" defer></script><script src="/gallery.js" defer></script><script src="/onesignal.js" defer></script>`;

function publishableScenes(storyboard, photos, chapterId) {
  const scenes = storyboard.scenes || [];
  return scenes.map((scene, index) => {
    if (!String(scene.title || "").trim()) throw new Error(`${chapterId} scene ${index + 1} has no individual heading`);
    if (!String(scene.text || "").trim()) throw new Error(`${chapterId} scene ${index + 1} has no individual caption`);
    if (!Array.isArray(scene.photos) || scene.photos.length !== 1) throw new Error(`${chapterId} scene ${index + 1} must contain exactly one photo`);
    const photo = photos.get(scene.photos[0]);
    if (!photo) throw new Error(`${chapterId} scene ${index + 1} references a photo outside the approved inventory`);
    return { title: scene.title, text: scene.text, photos: [photo] };
  });
}

const registry = await read("data/trips.json");
const registryTrip = registry.trips.find(item => item.id === trip);
if (!registryTrip) throw new Error(`Trip ${trip} is not registered`);
const tripFile = `data/${trip}/trip.json`; const tripData = await read(tripFile);
const chaptersView = tripData.views.find(view => ["chapters", "days"].includes(view.id));
if (!chaptersView?.items.length) throw new Error("Trip has no chapters");
const published = [];
for (const chapter of chaptersView.items) {
  const base = `data/${trip}/${chapter.id}`;
  const [inventory, review, storyboard, approval] = await Promise.all([read(`${base}-photos.json`), read(`${base}-author-review.json`), read(`${base}-storyboard.json`), read(`${base}-approval.json`)]);
  const fingerprint = assertSamePhotoSet(inventory, review, `${chapter.id} author-review`);
  if (approval.status !== "preview_approved" || approval.photos_fingerprint !== fingerprint || storyboard.photos_fingerprint !== fingerprint) throw new Error(`${chapter.id} is not approved for publication`);
  const photos = new Map(inventoryItems(inventory).map(photo => [photoId(photo), photo]));
  const heroReview = review.items.find(item => item.status === "hero"); const hero = photos.get(photoId(heroReview));
  if (!hero) throw new Error(`${chapter.id} has no hero`);
  const scenes = publishableScenes(storyboard, photos, chapter.id);
  const approvedStoryIds = new Set(review.items.filter(item => item.status === "hero" || item.status === "story").map(item => photoId(item)));
  const sceneIds = scenes.map(scene => photoId(scene.photos[0]));
  if (sceneIds.length !== approvedStoryIds.size || new Set(sceneIds).size !== sceneIds.length || sceneIds.some(id => !approvedStoryIds.has(id))) throw new Error(`${chapter.id} storyboard does not cover every approved hero/story photo exactly once`);
  const backstage = review.items.filter(item => item.status === "backstage").map(item => photos.get(photoId(item))).filter(Boolean);
  published.push({ id: chapter.id, label: "Глава", title: storyboard.chapter?.title || chapter.title, summary: storyboard.chapter?.intro || chapter.description || "", route: [], hero, scenes, backstage });
}
const cover = published.find(chapter => chapter.id === coverChapter)?.hero;
if (!cover) throw new Error("Selected cover chapter is not approved");
await materializePublicPhotos({ root, photos: published.flatMap(chapter => [chapter.hero, ...chapter.scenes.flatMap(scene => scene.photos), ...chapter.backstage]) });
const journal = { schema_version: 4, meta: { id: trip, title: registryTrip.title, subtitle: registryTrip.subtitle, period: registryTrip.period, description: registryTrip.description, route: [], cover }, editorial: { status: "approved", approved_by_author: true, published_at: new Date().toISOString(), layout_version: 3 }, chapters: published };
tripData.editorial_status = "published"; tripData.author_approved = true; tripData.cover_selection = { chapter_id: coverChapter, photo_url: cover.url, status: "author_selected" };
tripData.views = [{ id: "chapters", label: "Главы", items: published.map(chapter => ({ id: chapter.id, title: chapter.title, description: chapter.summary, href: `chapters/${chapter.id}.html`, cover_url: publicPhotoUrl(chapter.hero) })) }];
Object.assign(registryTrip, { cover_url: publicPhotoUrl(cover), status: "completed", published_days: published.length, total_days: published.length });
await fs.mkdir(path.join(root, `trips/${trip}/chapters`), { recursive: true });
const indexHtml = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${publicHead({ title: registryTrip.title, description: registryTrip.description, canonical: `/trips/${trip}/` })}${appHead}<link rel="stylesheet" href="../../trip-editorial-v3.css?v=2"></head><body data-trip-data="../../data/${trip}/journal.json"><main id="journal-content"></main><script src="../../trip-editorial-v3.js?v=7"></script>${appScripts}</body></html>`;
const chapterHtml = id => { const chapter = published.find(item => item.id === id); const title = `${chapter.title} · ${registryTrip.title}`; return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${publicHead({ title, description: chapter.summary || registryTrip.description, canonical: `/trips/${trip}/chapters/${id}.html` })}${appHead}<link rel="stylesheet" href="../../../trip-editorial-v3.css?v=2"></head><body data-trip-data="../../../data/${trip}/journal.json" data-chapter="${id}"><main id="journal-content"></main><script src="../../../trip-editorial-v3.js?v=7"></script>${appScripts}</body></html>`; };
await Promise.all([write("data/trips.json", registry), write(tripFile, tripData), write(`data/${trip}/journal.json`, journal), write(`trips/${trip}/index.html`, indexHtml), ...published.map(chapter => write(`trips/${trip}/chapters/${chapter.id}.html`, chapterHtml(chapter.id)))]);
console.log(`Published ${trip}: ${published.length} chapters, cover from ${coverChapter}, layout v3`);
