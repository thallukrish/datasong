export function createDiagnostics({ runId = '' } = {}) {
  return { version: 1, runId: String(runId), events: [] };
}

export function recordEvent(state, type, data = {}) {
  const event = { sequence: state.events.length + 1, type: String(type), data: { ...data } };
  state.events.push(event);
  return event;
}
