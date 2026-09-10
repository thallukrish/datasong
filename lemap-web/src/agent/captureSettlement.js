function arr(value) { return Array.isArray(value) ? value : []; }

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function captureSignature(capture = {}) {
  const entities = arr(capture.entities)
    .map((entity) => ({
      id: String(entity.id || ''),
      type: String(entity.type || ''),
      structural: stableValue({
        visible: entity.structural?.visible,
        disabled: entity.structural?.disabled,
        controlType: entity.structural?.controlType,
        cardinality: entity.structural?.cardinality,
        values: entity.structural?.values,
        checked: entity.structural?.checked,
        value: entity.structural?.value
      })
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ pageId: String(capture.pageId || ''), entities });
}

export async function waitForStructuralCaptureChange({
  before,
  capture,
  wait,
  now = () => Date.now(),
  timeoutMs = 3000,
  pollMs = 150
} = {}) {
  const baseline = captureSignature(before);
  const startedAt = now();
  let latest = before;

  while (now() - startedAt <= timeoutMs) {
    latest = await capture();
    if (captureSignature(latest) !== baseline) return { capture: latest, changed: true };
    if (now() - startedAt >= timeoutMs) break;
    await wait(pollMs);
  }

  return { capture: latest, changed: false };
}
