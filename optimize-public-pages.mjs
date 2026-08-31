import fs from "node:fs/promises";

const origin = "https://owntravel.ru";
const pages = [
  ["index.html", "/"],
  ["trips/kyrgyzstan-2026/index.html", "/trips/kyrgyzstan-2026/"],
  ...Array.from({ length: 8 }, (_, index) => {
    const day = `day${String(index + 1).padStart(2, "0")}`;
    return [`${day}.html`, `/${day}.html`];
  })
];

function escapeAttribute(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function cloudinaryVariant(url, width) {
  return url.replace(/\/image\/upload\/[^/]+\//, `/image/upload/f_auto,q_auto,w_${width}/`);
}

function enhanceImage(tag) {
  const source = tag.match(/\bsrc="([^"]+)"/)?.[1];
  if (!source) return tag;
  let result = tag;
  if (!/\bloading=/.test(result)) result = result.replace(/<img\b/, '<img loading="lazy"');
  if (!/\bdecoding=/.test(result)) result = result.replace(/<img\b/, '<img decoding="async"');
  if (source.includes("res.cloudinary.com") && !/\bsrcset=/.test(result)) {
    const srcset = [480, 800, 1200, 1600]
      .map(width => `${cloudinaryVariant(source, width)} ${width}w`)
      .join(", ");
    result = result.replace(/\bsrc="/, `srcset="${srcset}" sizes="(max-width: 899px) 100vw, 1200px" src="`);
  }
  return result;
}

function insertDiscoveryMetadata(html, pathname) {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1]?.trim() || "Журнал путешествий";
  const description = html.match(/<meta name="description" content="([^"]*)">/)?.[1]
    || `Фотографическая глава журнала путешествий: ${title}.`;
  const firstImage = html.match(/<img\b[^>]*\bsrc="([^"]+)"/)?.[1];
  const tags = [
    `<link rel="canonical" href="${origin}${pathname}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:locale" content="ru_RU">`,
    `<meta property="og:title" content="${escapeAttribute(title)}">`,
    `<meta property="og:description" content="${escapeAttribute(description)}">`,
    `<meta property="og:url" content="${origin}${pathname}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    firstImage ? `<meta property="og:image" content="${escapeAttribute(firstImage)}">` : ""
  ].filter(Boolean).join("\n  ");
  let result = html;
  if (!/name="description"/.test(result)) {
    result = result.replace(/<title>[^<]+<\/title>/, match => `${match}\n  <meta name="description" content="${escapeAttribute(description)}">`);
  }
  if (/rel="canonical"/.test(result)) return result;
  return result.replace(/<\/head>/, `  ${tags}\n</head>`);
}

function preloadCssHero(html) {
  if (/rel="preload"[^>]+as="image"[^>]+data-hero-preload/.test(html)) return html;
  const hero = html.match(/background(?:-image)?:\s*(?:linear-gradient\([^;]+?\),)?\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1]
    || html.match(/background:\s*url\(['"]?([^'")]+)['"]?\)/i)?.[1];
  if (!hero) return html;
  return html.replace(/<\/head>/, `  <link rel="preload" as="image" href="${escapeAttribute(hero)}" fetchpriority="high" data-hero-preload>\n</head>`);
}

for (const [file, pathname] of pages) {
  let html = await fs.readFile(file, "utf8");
  html = html.replace(/<img\b[^>]*>/g, enhanceImage);
  html = insertDiscoveryMetadata(html, pathname);
  html = preloadCssHero(html);
  await fs.writeFile(file, html);
}

console.log(`Optimized ${pages.length} public pages`);
