import fs from "fs/promises";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const dayTag = process.env.DAY_TAG || "day01";
const outFile = process.env.OUT_FILE || "data/day01-photos.json";

if (!cloudName || !apiKey || !apiSecret) {
  throw new Error("Cloudinary secrets are missing");
}

const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString("base64");

const url =
  `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/tags/${encodeURIComponent(dayTag)}` +
  `?max_results=100&context=true&metadata=true`;

const response = await fetch(url, {
  headers: {
    Authorization: `Basic ${auth}`
  }
});

if (!response.ok) {
  const text = await response.text();
  throw new Error(`Cloudinary error: ${response.status} ${text}`);
}

const data = await response.json();

const photos = (data.resources || [])
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  .map((item) => ({
    public_id: item.public_id,
    url: item.secure_url,
    width: item.width,
    height: item.height,
    created_at: item.created_at
  }));

await fs.mkdir("data", { recursive: true });
await fs.writeFile(outFile, JSON.stringify(photos, null, 2), "utf8");

console.log(`Saved ${photos.length} photos to ${outFile}`);