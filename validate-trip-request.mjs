import fs from "node:fs/promises";
import { validatePhotoSourceUrl, validateTripId } from "./create-trip.mjs";

const requestPath = process.argv[2];
if (!requestPath) throw new Error("Укажите путь к заявке");
const request = JSON.parse(await fs.readFile(requestPath, "utf8"));
if (request.schema_version !== 1 || request.type !== "new_trip_request") throw new Error("Неизвестный формат заявки");
validateTripId(request.trip?.id);
if (!request.trip?.title?.trim()) throw new Error("Не указано название путешествия");
if (!Array.isArray(request.chapters) || !request.chapters.length) throw new Error("Добавьте хотя бы одну главу");

for (const [index, chapter] of request.chapters.entries()) {
  if (!chapter.title?.trim()) throw new Error(`Глава ${index + 1}: не указано название`);
  if (!chapter.photo_source_url && !(chapter.photos?.length)) throw new Error(`Глава «${chapter.title}»: не указаны фотографии`);
  if (chapter.photo_source_url) validatePhotoSourceUrl(chapter.photo_source_url);
}

console.log(`Заявка корректна: ${request.trip.title}, глав: ${request.chapters.length}`);
