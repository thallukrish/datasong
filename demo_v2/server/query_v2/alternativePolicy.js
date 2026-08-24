import { arr } from './modelJson.js';

export const WARM_ALTERNATIVE_MIN_CONFIDENCE = 0.5;

export function partitionCandidates(assessments, minConfidence = WARM_ALTERNATIVE_MIN_CONFIDENCE) {
  const ranked = arr(assessments)
    .filter((item) => item?.decision === 'candidate')
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0) || String(a.name || '').localeCompare(String(b.name || '')));
  return {
    warm:ranked.filter((item) => Number(item.confidence || 0) >= minConfidence),
    cold:ranked.filter((item) => Number(item.confidence || 0) < minConfidence)
  };
}

export function remainingWarmAlternativeCount(stack) {
  let count = 0;
  for (const frame of arr(stack)) {
    if (frame?.kind !== 'hierarchy') continue;
    count += arr(frame.alternatives).length;
    count += arr(frame.deferred).filter((item) => Number(item.revisits || 0) < 1 && Number(item.confidence || 0) >= WARM_ALTERNATIVE_MIN_CONFIDENCE).length;
  }
  return count;
}
