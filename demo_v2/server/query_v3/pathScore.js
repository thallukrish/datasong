export const SCORE_MIN = 0;
export const SCORE_MAX = 1;
export const COVERAGE_MIN = 0.5;

const clamp = (v) => Math.max(SCORE_MIN, Math.min(SCORE_MAX, Number(v || 0)));

export function scoreVector(dimensions, pairs = []) {
  const out = Object.fromEntries(dimensions.map((name) => [name, 0]));
  for (const pair of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(pair)) continue;
    const index = Number(pair[0]);
    if (!Number.isInteger(index) || !dimensions[index]) continue;
    out[dimensions[index]] = clamp(pair[1]);
  }
  return out;
}

export function activeScore(vector, missingDimensions) {
  const names = missingDimensions.length ? missingDimensions : Object.keys(vector || {});
  return Math.max(0, ...names.map((name) => clamp(vector?.[name])));
}

export function deltaVector(parent = {}, child = {}) {
  const names = new Set([...Object.keys(parent), ...Object.keys(child)]);
  return Object.fromEntries([...names].map((name) => [name, Number((clamp(child[name]) - clamp(parent[name])).toFixed(3))]));
}

export function compactVector(vector = {}, dimensions = []) {
  return dimensions.map((name, index) => [index, clamp(vector[name])]).filter(([, score]) => score > 0);
}
