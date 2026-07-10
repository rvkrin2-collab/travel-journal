const originalFetch = globalThis.fetch;
const maxAttempts = 6;
const minimumGapMs = 1200;
let lastRequestAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryDelayMs(response, bodyText, attempt) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.ceil(retryAfter * 1000) + 500;
  }

  const match = String(bodyText || "").match(/try again in\s+([\d.]+)s/i);
  if (match) return Math.ceil(Number(match[1]) * 1000) + 500;

  return Math.min(30000, 2000 * 2 ** attempt) + Math.floor(Math.random() * 500);
}

globalThis.fetch = async function fetchWithRateLimitRetry(input, init) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < minimumGapMs) await sleep(minimumGapMs - elapsed);
    lastRequestAt = Date.now();

    const response = await originalFetch(input, init);
    if (response.status !== 429) return response;

    const bodyText = await response.text();
    if (attempt === maxAttempts - 1) {
      return new Response(bodyText, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }

    const delay = retryDelayMs(response, bodyText, attempt);
    console.warn(`OpenAI rate limit reached. Retry ${attempt + 1}/${maxAttempts - 1} in ${delay} ms.`);
    await sleep(delay);
  }

  throw new Error("Rate-limit retry loop ended unexpectedly");
};

await import("./build-review-v2.mjs");
