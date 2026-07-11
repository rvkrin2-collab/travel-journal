const VERSION = "travel-journal-v6";
const APP_CACHE = `${VERSION}-app`;
const IMAGE_CACHE = `${VERSION}-images`;
const OFFLINE_URL = "/offline.html";
const CLOUDINARY_MARKER = "/image/upload/";
const CLOUDINARY_TRANSFORM_TOKEN = /^(?:a|ac|af|ar|b|bo|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|if|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_/i;

const APP_SHELL = [
  "/",
  "/index.html",
  "/offline.html",
  "/style.css",
  "/manifest.webmanifest",
  "/pwa.js",
  "/gallery.js",
  "/service-worker.js",
  "/data/trips.json",
  "/trips/kyrgyzstan-2026/",
  "/day01.html",
  "/day02.html",
  "/day03.html",
  "/day04.html",
  "/day05.html",
  "/day06.html",
  "/day07.html",
  "/day08.html",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => Promise.all(APP_SHELL.map(async url => {
        try {
          await cache.add(url);
        } catch (error) {
          console.warn("Precache skipped", url, error);
        }
      })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => ![APP_CACHE, IMAGE_CACHE].includes(key)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isPrivateOrDraftPath(url) {
  return url.origin === self.location.origin && (
    url.pathname === "/editor.html" ||
    url.pathname === "/preview.html" ||
    /\/(?:data\/.*(?:ai-review|author-review|final-review|storyboard)|admin|draft)/i.test(url.pathname)
  );
}

function isPublicNavigation(url) {
  return url.origin === self.location.origin && (
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname === "/offline.html" ||
    /^\/day\d+\.html$/i.test(url.pathname) ||
    /^\/trips\/[a-z0-9-]+\/?$/i.test(url.pathname)
  );
}

function isUntransformedCloudinaryImage(url) {
  if (url.hostname !== "res.cloudinary.com" || !url.pathname.includes(CLOUDINARY_MARKER)) return false;
  const remainder = url.pathname.split(CLOUDINARY_MARKER)[1] || "";
  const firstSegment = remainder.split("/").filter(Boolean)[0] || "";
  if (!firstSegment || /^v\d+$/i.test(firstSegment)) return true;
  return !firstSegment.split(",").every(token => CLOUDINARY_TRANSFORM_TOKEN.test(token));
}

async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) || (await cache.match(new URL(request.url).pathname)) || (await cache.match(OFFLINE_URL));
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(response => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || network || Response.error();
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  while (keys.length > maxItems) {
    await cache.delete(keys.shift());
  }
}

async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === "opaque")) {
    await cache.put(request, response.clone());
    trimCache(IMAGE_CACHE, 120).catch(() => {});
  }
  return response;
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isPrivateOrDraftPath(url)) return;

  if (request.mode === "navigate") {
    if (isPublicNavigation(url)) event.respondWith(networkFirst(request));
    return;
  }

  if (url.origin === self.location.origin && url.pathname === "/data/trips.json") {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (request.destination === "image") {
    if (isUntransformedCloudinaryImage(url)) {
      event.respondWith(fetch(request));
    } else {
      event.respondWith(cacheFirstImage(request).catch(() => caches.match("/icons/icon-192.png")));
    }
    return;
  }

  if (url.origin === self.location.origin && ["style", "script", "manifest", "font"].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
