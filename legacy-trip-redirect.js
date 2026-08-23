(() => {
  const roots = ["kolskiy-bereg-i-more", "kolskiy-mezhdu-beregom-i-morem", "kolskiy-u-vody-i-pod-vodoy"];
  const match = location.pathname.match(/^\/trips\/([^/]+)(?:\/(?:chapters|days)\/([^/.]+)\.html)?\/?$/);
  if (!match || !roots.includes(match[1])) return;
  const chapterAliases = {
    "v-holodnyh-vodah": "pod-vodoy-barentseva-morya",
    "pod-vodoy": "pod-vodoy-barentseva-morya",
    "teriberka-na-krayu-zemli": "teriberka",
    "titovka-i-p-ov-nemetskiy-zhizn-u-morya": "kray-zemli"
  };
  const chapter = chapterAliases[match[2]] || match[2];
  location.replace(chapter ? `/trips/kolskiy/chapters/${chapter}.html` : "/trips/kolskiy/");
})();
