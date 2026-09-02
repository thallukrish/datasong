function arr(value) { return Array.isArray(value) ? value : []; }

export function normalizeObservation(input = {}) {
  const trace = input.executionTrace || {};
  return {
    id: String(input.id || `observation:${input.fieldId || 'unknown'}:${input.action?.id || 'action'}`),
    entityId: String(input.entityId || ''),
    fieldId: String(input.fieldId || ''),
    groupId: String(input.groupId || ''),
    beforeStateId: String(input.beforeStateId || ''),
    action: { ...(input.action || {}) },
    executionTrace: {
      browserEvents: arr(trace.browserEvents).map((x) => ({ ...x })),
      functions: arr(trace.functions).map((x) => ({ ...x })),
      network: arr(trace.network).map((x) => ({ ...x })),
      callbacks: arr(trace.callbacks).map((x) => ({ ...x })),
      consoleSignals: arr(trace.consoleSignals).map((x) => ({ ...x }))
    },
    result: { ...(input.result || {}) },
    affectedEntityIds: [...new Set(arr(input.affectedEntityIds).map(String).filter(Boolean))],
    afterStateId: String(input.afterStateId || '')
  };
}
