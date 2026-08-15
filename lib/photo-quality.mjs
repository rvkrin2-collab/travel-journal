const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function hammingDistance(left = "", right = "") {
  const length = Math.max(left.length, right.length);
  let distance = 0;
  for (let index = 0; index < length; index++) distance += left[index] !== right[index] ? 1 : 0;
  return distance;
}

export function qualityScore({ sharpness = 0, exposure = 0, contrast = 0 } = {}) {
  const sharpnessScore = clamp(sharpness / 900, 0, 1);
  const exposureScore = clamp(1 - Math.abs(exposure - 0.52) / 0.52, 0, 1);
  const contrastScore = clamp(contrast / 0.24, 0, 1);
  return Math.round((sharpnessScore * 0.55 + exposureScore * 0.3 + contrastScore * 0.15) * 100);
}

export function preselectPhotos(items, { duplicateDistance = 8, minimumScore = 38 } = {}) {
  const ranked = items.map((item, index) => ({ ...item, originalIndex: index }))
    .sort((left, right) => right.score - left.score || left.originalIndex - right.originalIndex);
  const selected = [];
  const rejected = [];

  for (const item of ranked) {
    const duplicate = selected.find(candidate => hammingDistance(item.hash, candidate.hash) <= duplicateDistance);
    if (duplicate) rejected.push({ ...item, status: "duplicate", duplicateOf: duplicate.id });
    else if (item.score < minimumScore) rejected.push({ ...item, status: "technical-reject" });
    else selected.push({ ...item, status: "selected" });
  }

  return {
    selected: selected.sort((a, b) => a.originalIndex - b.originalIndex),
    rejected: rejected.sort((a, b) => a.originalIndex - b.originalIndex)
  };
}
