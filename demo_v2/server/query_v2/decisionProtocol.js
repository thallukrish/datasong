import { arr, key, text } from './modelJson.js';

export function dimensionCodec(dimensions = []) {
  const names = arr(dimensions).map(String);
  const byIndex = new Map(names.map((name, i) => [String(i), name]));
  const byKey = new Map(names.map((name, i) => [key(name), String(i)]));
  return { names, byIndex, byKey };
}

export function optionCodec(options = [], { descriptionMax = 80 } = {}) {
  const list = arr(options);
  const byIndex = new Map();
  const encoded = list.map((option, i) => {
    const idx = String(i);
    byIndex.set(idx, option);
    const description = text(option?.description || '', descriptionMax);
    return description ? [i, option?.name || '', description] : [i, option?.name || ''];
  });
  return { encoded, byIndex };
}

export function acceptedSummary(accepted, dimensionMap) {
  return [...accepted.values()].map((item) => [
    item.entity,
    arr(item.dimensions)
      .filter((d) => Number(d?.confidence || 0) > 0)
      .map((d) => [Number(dimensionMap.byKey.get(key(d.dimension))), Number(d.confidence || 0)])
      .filter(([i]) => Number.isInteger(i))
  ]);
}

export function uncoveredDimensionIndexes(accepted, dimensions, dimensionMap) {
  const covered = new Set();
  for (const item of accepted.values()) {
    for (const d of arr(item.dimensions)) if (Number(d?.confidence || 0) > 0) covered.add(key(d.dimension));
  }
  return arr(dimensions)
    .map((name) => dimensionMap.byKey.get(key(name)))
    .filter((idx) => idx !== undefined && !covered.has(key(dimensions[Number(idx)])))
    .map(Number);
}

export function decodeSparseDecision(parsed, options, dimensions, optionMap, dimensionMap, { omittedDecision = 'unassessed' } = {}) {
  const byId = new Map();
  const dimensionFromPairs = (pairs) => arr(pairs).map((pair) => {
    const supplied = Array.isArray(pair) ? pair : [];
    const name = dimensionMap.byIndex.get(String(supplied[0]));
    const confidence = Math.max(0, Math.min(1, Number(supplied[1] || 0)));
    return name && confidence > 0 ? { dimension:name, confidence } : null;
  }).filter(Boolean);

  for (const item of arr(parsed?.c)) {
    const pair = Array.isArray(item) ? item : [];
    const option = optionMap.get(String(pair[0]));
    if (!option || byId.has(String(option.id))) continue;
    const dims = dimensionFromPairs(pair[1]);
    byId.set(String(option.id), {
      id:option.id,
      name:option.name,
      decision:'candidate',
      dimensions:dims,
      confidence:Math.max(0, ...dims.map((d) => Number(d.confidence || 0)))
    });
  }
  for (const rawIndex of arr(parsed?.r)) {
    const option = optionMap.get(String(rawIndex));
    if (!option || byId.has(String(option.id))) continue;
    byId.set(String(option.id), { id:option.id, name:option.name, decision:'reject', dimensions:[], confidence:0 });
  }

  return arr(options).map((option) => byId.get(String(option.id)) || {
    id:option.id,
    name:option.name,
    decision:omittedDecision,
    dimensions:[],
    confidence:0
  });
}

export function decisionPayload({ intent, dimensions, accepted, options, descriptionMax = 80 }) {
  const dimensionMap = dimensionCodec(dimensions);
  const optionMap = optionCodec(options, { descriptionMax });
  return {
    payload:{
      i:text(intent || '', 140),
      d:dimensionMap.names.map((name, i) => [i, name]),
      u:uncoveredDimensionIndexes(accepted, dimensions, dimensionMap),
      a:acceptedSummary(accepted, dimensionMap),
      o:optionMap.encoded
    },
    dimensionMap,
    optionMap:optionMap.byIndex
  };
}
