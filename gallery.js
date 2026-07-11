(() => {
  const CLOUDINARY_HOST = "res.cloudinary.com";
  const CLOUDINARY_MARKER = "/image/upload/";
  const TRANSFORM_TOKEN = /^(?:a|ac|af|ar|b|bo|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|if|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_/i;

  function isCloudinaryImage(src) {
    try {
      const url = new URL(src, window.location.href);
      return url.hostname === CLOUDINARY_HOST && url.pathname.includes(CLOUDINARY_MARKER);
    } catch {
      return false;
    }
  }

  function isTransformationSegment(segment) {
    if (!segment || /^v\d+$/i.test(segment)) return false;
    const tokens = segment.split(",");
    return tokens.length > 0 && tokens.every(token => TRANSFORM_TOKEN.test(token));
  }

  function originalCloudinaryUrl(src) {
    const url = new URL(src, window.location.href);
    const markerIndex = url.pathname.indexOf(CLOUDINARY_MARKER);
    if (markerIndex === -1) return url.href;

    const prefix = url.pathname.slice(0, markerIndex + CLOUDINARY_MARKER.length);
    const remainder = url.pathname.slice(markerIndex + CLOUDINARY_MARKER.length);
    const parts = remainder.split("/").filter(Boolean);

    while (parts.length && isTransformationSegment(parts[0])) parts.shift();

    url.pathname = prefix + parts.join("/");
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function uniqueImages() {
    const selectors = [
      ".scene img",
      ".backstage img",
      "[data-gallery] img",
      "img[data-gallery-item]"
    ];
    const seen = new Set();
    return Array.from(document.querySelectorAll(selectors.join(","))).filter(image => {
      const src = image.currentSrc || image.src;
      if (!src || !isCloudinaryImage(src) || image.dataset.galleryIgnore === "true") return false;
      const key = originalCloudinaryUrl(src);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function installStyles() {
    if (document.querySelector("#travel-gallery-styles")) return;
    const style = document.createElement("style");
    style.id = "travel-gallery-styles";
    style.textContent = `
      .scene img,.backstage img,[data-gallery] img,img[data-gallery-item]{cursor:zoom-in}
      .tj-lightbox[hidden]{display:none}
      .tj-lightbox{position:fixed;inset:0;z-index:100000;background:rgba(10,12,11,.97);color:#fff8ec;opacity:0;transition:opacity .18s ease}
      .tj-lightbox.is-open{opacity:1}
      .tj-lightbox__viewport{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;touch-action:none;user-select:none}
      .tj-lightbox__image{display:block;max-width:100vw;max-height:100svh;width:auto;height:auto;object-fit:contain;transform-origin:center center;will-change:transform;cursor:grab}
      .tj-lightbox__image.is-dragging{cursor:grabbing}
      .tj-lightbox__toolbar{position:absolute;top:0;left:0;right:0;z-index:4;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:calc(12px + env(safe-area-inset-top)) 14px 12px;background:linear-gradient(to bottom,rgba(0,0,0,.68),transparent)}
      .tj-lightbox__tools{display:flex;align-items:center;gap:8px}
      .tj-lightbox__counter{font:500 12px/1 Inter,system-ui,sans-serif;letter-spacing:.08em;color:rgba(255,248,236,.82)}
      .tj-lightbox__button,.tj-lightbox__original{display:inline-flex;align-items:center;justify-content:center;min-width:42px;height:42px;border:1px solid rgba(255,248,236,.28);border-radius:999px;background:rgba(18,22,20,.5);backdrop-filter:blur(12px);color:#fff8ec;text-decoration:none;font:600 13px/1 Inter,system-ui,sans-serif;cursor:pointer}
      .tj-lightbox__original{padding:0 14px}
      .tj-lightbox__button:hover,.tj-lightbox__original:hover{background:rgba(255,248,236,.14)}
      .tj-lightbox__nav{position:absolute;top:50%;z-index:4;transform:translateY(-50%);font-size:28px}
      .tj-lightbox__prev{left:12px}.tj-lightbox__next{right:12px}
      .tj-lightbox__caption{position:absolute;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));z-index:4;transform:translateX(-50%);max-width:min(760px,calc(100vw - 120px));padding:9px 13px;border-radius:16px;background:rgba(10,12,11,.52);backdrop-filter:blur(12px);color:rgba(255,248,236,.9);text-align:center;font:400 13px/1.35 Inter,system-ui,sans-serif}
      .tj-lightbox__caption:empty{display:none}
      .tj-lightbox__loading{position:absolute;left:50%;top:50%;z-index:3;transform:translate(-50%,-50%);padding:9px 12px;border-radius:999px;background:rgba(10,12,11,.58);font:500 12px/1 Inter,system-ui,sans-serif;color:rgba(255,248,236,.85);pointer-events:none}
      .tj-lightbox__loading[hidden]{display:none}
      @media(max-width:700px){.tj-lightbox__nav{top:auto;bottom:calc(16px + env(safe-area-inset-bottom));transform:none}.tj-lightbox__prev{left:14px}.tj-lightbox__next{right:14px}.tj-lightbox__caption{bottom:calc(72px + env(safe-area-inset-bottom));max-width:calc(100vw - 28px)}.tj-lightbox__toolbar{padding-left:10px;padding-right:10px}.tj-lightbox__original{padding:0 12px}}
      @media(prefers-reduced-motion:reduce){.tj-lightbox{transition:none}}
    `;
    document.head.appendChild(style);
  }

  function createViewer(images) {
    const overlay = document.createElement("div");
    overlay.className = "tj-lightbox";
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Просмотр фотографии");
    overlay.innerHTML = `
      <div class="tj-lightbox__viewport">
        <img class="tj-lightbox__image" alt="">
        <div class="tj-lightbox__loading" hidden>Загрузка оригинала…</div>
      </div>
      <div class="tj-lightbox__toolbar">
        <div class="tj-lightbox__counter"></div>
        <div class="tj-lightbox__tools">
          <a class="tj-lightbox__original" href="#" target="_blank" rel="noopener">Оригинал</a>
          <button class="tj-lightbox__button tj-lightbox__close" type="button" aria-label="Закрыть">×</button>
        </div>
      </div>
      <button class="tj-lightbox__button tj-lightbox__nav tj-lightbox__prev" type="button" aria-label="Предыдущая фотография">‹</button>
      <button class="tj-lightbox__button tj-lightbox__nav tj-lightbox__next" type="button" aria-label="Следующая фотография">›</button>
      <div class="tj-lightbox__caption"></div>
    `;
    document.body.appendChild(overlay);

    const viewport = overlay.querySelector(".tj-lightbox__viewport");
    const displayedImage = overlay.querySelector(".tj-lightbox__image");
    const loading = overlay.querySelector(".tj-lightbox__loading");
    const counter = overlay.querySelector(".tj-lightbox__counter");
    const caption = overlay.querySelector(".tj-lightbox__caption");
    const originalLink = overlay.querySelector(".tj-lightbox__original");
    const closeButton = overlay.querySelector(".tj-lightbox__close");
    const previousButton = overlay.querySelector(".tj-lightbox__prev");
    const nextButton = overlay.querySelector(".tj-lightbox__next");

    let currentIndex = 0;
    let isOpen = false;
    let loadToken = 0;
    let previousFocus = null;
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let pointerStart = null;
    let transformStart = null;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;
    const pointers = new Map();

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function applyTransform() {
      displayedImage.style.transform = `translate3d(${translateX}px,${translateY}px,0) scale(${scale})`;
    }

    function resetTransform() {
      scale = 1;
      translateX = 0;
      translateY = 0;
      pointerStart = null;
      transformStart = null;
      pinchStartDistance = 0;
      pinchStartScale = 1;
      pointers.clear();
      displayedImage.classList.remove("is-dragging");
      applyTransform();
    }

    function setScale(nextScale) {
      scale = clamp(nextScale, 1, 5);
      if (scale === 1) {
        translateX = 0;
        translateY = 0;
      }
      applyTransform();
    }

    function render() {
      const sourceImage = images[currentIndex];
      const previewUrl = sourceImage.currentSrc || sourceImage.src;
      const originalUrl = originalCloudinaryUrl(previewUrl);
      const token = ++loadToken;

      resetTransform();
      displayedImage.src = previewUrl;
      displayedImage.alt = sourceImage.alt || "Фотография путешествия";
      caption.textContent = sourceImage.alt || "";
      counter.textContent = `${currentIndex + 1} / ${images.length}`;
      originalLink.href = originalUrl;
      previousButton.hidden = images.length < 2;
      nextButton.hidden = images.length < 2;

      if (originalUrl === previewUrl) {
        loading.hidden = true;
        return;
      }

      loading.hidden = false;
      const original = new Image();
      original.decoding = "async";
      original.onload = () => {
        if (!isOpen || token !== loadToken) return;
        displayedImage.src = originalUrl;
        loading.hidden = true;
      };
      original.onerror = () => {
        if (token === loadToken) loading.hidden = true;
      };
      original.src = originalUrl;
    }

    function open(index) {
      currentIndex = index;
      isOpen = true;
      previousFocus = document.activeElement;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      overlay.hidden = false;
      render();
      requestAnimationFrame(() => overlay.classList.add("is-open"));
      closeButton.focus({preventScroll: true});
    }

    function close() {
      if (!isOpen) return;
      isOpen = false;
      loadToken += 1;
      overlay.classList.remove("is-open");
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      resetTransform();
      window.setTimeout(() => {
        overlay.hidden = true;
        displayedImage.removeAttribute("src");
      }, 180);
      if (previousFocus && typeof previousFocus.focus === "function") previousFocus.focus({preventScroll: true});
    }

    function show(delta) {
      if (images.length < 2) return;
      currentIndex = (currentIndex + delta + images.length) % images.length;
      render();
    }

    images.forEach((image, index) => {
      image.tabIndex = image.tabIndex >= 0 ? image.tabIndex : 0;
      image.setAttribute("role", "button");
      image.setAttribute("aria-label", `${image.alt || "Фотография"}. Открыть в полном размере`);
      image.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        open(index);
      });
      image.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open(index);
        }
      });
    });

    closeButton.addEventListener("click", close);
    previousButton.addEventListener("click", () => show(-1));
    nextButton.addEventListener("click", () => show(1));

    overlay.addEventListener("click", event => {
      if (event.target === overlay || event.target === viewport) close();
    });

    document.addEventListener("keydown", event => {
      if (!isOpen) return;
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") show(-1);
      if (event.key === "ArrowRight") show(1);
      if (event.key === "+" || event.key === "=") setScale(scale + 0.5);
      if (event.key === "-") setScale(scale - 0.5);
      if (event.key === "0") resetTransform();
    });

    viewport.addEventListener("wheel", event => {
      if (!isOpen) return;
      event.preventDefault();
      setScale(scale + (event.deltaY < 0 ? 0.35 : -0.35));
    }, {passive: false});

    displayedImage.addEventListener("dblclick", event => {
      event.preventDefault();
      setScale(scale > 1 ? 1 : 2.5);
    });

    viewport.addEventListener("pointerdown", event => {
      if (!isOpen) return;
      viewport.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
      displayedImage.classList.add("is-dragging");

      if (pointers.size === 1) {
        pointerStart = {x: event.clientX, y: event.clientY, time: performance.now()};
        transformStart = {x: translateX, y: translateY};
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        pinchStartDistance = Math.hypot(b.x - a.x, b.y - a.y);
        pinchStartScale = scale;
      }
    });

    viewport.addEventListener("pointermove", event => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, {x: event.clientX, y: event.clientY});

      if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const distance = Math.hypot(b.x - a.x, b.y - a.y);
        if (pinchStartDistance > 0) setScale(pinchStartScale * (distance / pinchStartDistance));
        return;
      }

      if (pointers.size === 1 && pointerStart && transformStart && scale > 1) {
        translateX = transformStart.x + event.clientX - pointerStart.x;
        translateY = transformStart.y + event.clientY - pointerStart.y;
        applyTransform();
      }
    });

    function finishPointer(event) {
      const start = pointerStart;
      pointers.delete(event.pointerId);
      try { viewport.releasePointerCapture(event.pointerId); } catch {}

      if (pointers.size === 0) {
        displayedImage.classList.remove("is-dragging");
        if (start && scale === 1) {
          const deltaX = event.clientX - start.x;
          const deltaY = event.clientY - start.y;
          const elapsed = performance.now() - start.time;
          if (elapsed < 700 && Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
            show(deltaX < 0 ? 1 : -1);
          }
        }
        pointerStart = null;
        transformStart = null;
      } else if (pointers.size === 1) {
        const [remaining] = Array.from(pointers.values());
        pointerStart = {x: remaining.x, y: remaining.y, time: performance.now()};
        transformStart = {x: translateX, y: translateY};
      }
    }

    viewport.addEventListener("pointerup", finishPointer);
    viewport.addEventListener("pointercancel", finishPointer);
  }

  function init() {
    const images = uniqueImages();
    if (!images.length) return;
    installStyles();
    createViewer(images);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {once: true});
  } else {
    init();
  }
})();
