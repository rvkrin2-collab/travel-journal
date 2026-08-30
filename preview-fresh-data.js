(() => {
  const nativeFetch = window.fetch.bind(window);
  const repoRawBase = "https://raw.githubusercontent.com/rvkrin2-collab/travel-journal/main/";
  const freshEditorialPath = /^\/data\/[a-z0-9-]+\/[a-z0-9-]+-(?:author-review|final-review|storyboard|author-feedback|approval)\.json$/;

  window.fetch = (input, init) => {
    const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    if (!requestUrl) return nativeFetch(input, init);

    const resolved = new URL(requestUrl, location.href);
    if (resolved.origin === location.origin && freshEditorialPath.test(resolved.pathname)) {
      const rawUrl = `${repoRawBase}${resolved.pathname.slice(1)}?v=${Date.now()}`;
      return nativeFetch(rawUrl, { ...init, cache: "no-store" });
    }
    return nativeFetch(input, init);
  };
})();
