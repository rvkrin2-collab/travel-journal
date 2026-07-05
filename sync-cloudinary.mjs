import fs from "fs/promises";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const trip = process.env.TRIP || process.env.TRIP_TAG || "kyrgyzstan-2026";
const dayTag = process.env.DAY_TAG || "day01";
const outFile = process.env.OUT_FILE || `data/${trip}/${dayTag}-photos.json`;

if (!cloudName || !apiKey || !apiSecret) {
  throw new Error("Cloudinary secrets are missing");
}

if (!trip) {
  throw new Error("TRIP is required");
}

if (!dayTag) {
  throw new Error("DAY_TAG is required");
}

const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

async function fetchPage(nextCursor = "") {
  const params = new URLSearchParams({
    max_results: "100",
    context: "true",
    metadata: "true",
    tags: "true"
  });

  if (nextCursor) {
    params.set("next_cursor", nextCursor);
  }

  const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/tags/${encodeURIComponent(dayTag)}?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Cloudinary error: ${response.status} ${text}`);
  }

  return response.json();
}

function deduplicateByPublicId(items) {
  const byPublicId = new Map();

  for (const item of items) {
    if (!item?.public_id) continue;
    byPublicId.set(item.public_id, item);
  }

  return Array.from(byPublicId.values());
}

let resources = [];
let nextCursor = "";

do {
  const data = await fetchPage(nextCursor);
  resources = resources.concat(data.resources || []);
  nextCursor = data.next_cursor || "";
} while (nextCursor);

resources = deduplicateByPublicId(
  resources.filter((item) => Array.isArray(item.tags) && item.tags.includes(trip))
);

const photos = resources
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  .map((item) => ({
    public_id: item.public_id,
    url: item.secure_url,
    width: item.width,
    height: item.height,
    created_at: item.created_at,
    tags: item.tags || []
  }));

await fs.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await fs.writeFile(outFile, JSON.stringify(photos, null, 2), "utf8");

console.log(`Saved ${photos.length} unique photos to ${outFile}`);
console.log(`Trip: ${trip}`);
console.log(`Day tag: ${dayTag}`);
