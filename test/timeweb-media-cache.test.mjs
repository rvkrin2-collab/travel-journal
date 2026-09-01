import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

test("Timeweb media cache stores an immutable origin response", async () => {
  let originRequests = 0;
  const origin = createServer((request, response) => {
    originRequests += 1;
    response.writeHead(200, { "Content-Type": "image/jpeg", ETag: '"photo-etag"' });
    response.end(Buffer.from([1, 2, 3, 4]));
  });
  await listen(origin);
  const cacheRoot = await mkdtemp(join(tmpdir(), "owntravel-media-test-"));
  process.env.MEDIA_ORIGIN = `http://127.0.0.1:${origin.address().port}`;
  process.env.CACHE_ROOT = cacheRoot;
  const { startServer } = await import(`../timeweb/media-cache/server.mjs?test=${Date.now()}`);
  const cache = startServer(0);
  await new Promise(resolve => cache.once("listening", resolve));
  const url = `http://127.0.0.1:${cache.address().port}/thumbnail/trip/chapter/photo.jpg?w=720`;

  try {
    const first = await fetch(url);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-owntravel-cache"), "MISS");
    assert.deepEqual([...new Uint8Array(await first.arrayBuffer())], [1, 2, 3, 4]);

    const second = await fetch(url);
    assert.equal(second.headers.get("x-owntravel-cache"), "HIT");
    assert.equal(second.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(originRequests, 1);

    const invalid = await fetch(`http://127.0.0.1:${cache.address().port}/thumbnail/%2e%2e/secret.jpg`);
    assert.equal(invalid.status, 404);
  } finally {
    await Promise.all([close(cache), close(origin)]);
    await rm(cacheRoot, { recursive: true, force: true });
  }
});

test("Timeweb routing keeps the public site out of the VPS", async () => {
  const [caddy, compose] = await Promise.all([
    readFile(new URL("../timeweb/Caddyfile", import.meta.url), "utf8"),
    readFile(new URL("../timeweb/compose.yaml", import.meta.url), "utf8")
  ]);
  assert.match(caddy, /^api\.owntravel\.ru \{/m);
  assert.doesNotMatch(caddy, /^owntravel\.ru/m);
  assert.match(caddy, /reverse_proxy media:8080/);
  assert.match(compose, /45\.139\.77\.232:443:443/);
  assert.match(compose, /media_cache:\/cache/);
});
