import fs from "node:fs/promises";
import path from "node:path";
import { createTripFromRequest } from "./create-trip.mjs";

const requestsDirectory = process.env.REQUESTS_DIR || "requests";
const entries = await fs.readdir(requestsDirectory, { withFileTypes: true });
const requests = entries.filter(entry => entry.isFile() && entry.name.endsWith(".json")).map(entry => path.join(requestsDirectory, entry.name));
let created = 0;
let updated = 0;

for (const requestPath of requests) {
  const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
  if (request.type !== "new_trip_request" || !request.trip?.id) throw new Error(`${requestPath}: некорректная заявка`);
  const tripPath = path.join("data", request.trip.id, "trip.json");
  const existed = await fs.access(tripPath).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; });
  await createTripFromRequest(requestPath);
  console.log(`${existed ? "Обновлён" : "Создан"} черновик: ${request.trip.id}`);
  if (existed) updated++; else created++;
}

console.log(`Готово: создано ${created}, обновлено ${updated}`);
