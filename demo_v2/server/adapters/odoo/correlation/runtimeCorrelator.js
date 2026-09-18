function arr(value) { return Array.isArray(value) ? value : []; }
function uniq(values) { return [...new Set(values.map(String).filter(Boolean))]; }

function eventKey(event) {
  return `${String(event?.model || '')}.${String(event?.method || '')}`;
}

function symbolMatchesEvent(symbol, event) {
  const meta = symbol?.odooExecution || {};
  if (String(meta.modelName || '') !== String(event?.model || '')) return false;
  if (String(meta.methodName || '') !== String(event?.method || '')) return false;
  if (event?.addon && meta.addon && String(meta.addon) !== String(event.addon)) return false;
  if (event?.source && meta.sourcePath && !String(event.source).replace(/\\/g, '/').endsWith(String(meta.sourcePath).replace(/\\/g, '/'))) return false;
  return true;
}

function mergeEvidence(target = {}, event) {
  const scenarioIds = uniq([...(target.scenarioIds || []), event.scenarioId]);
  const sessionIds = uniq([...(target.sessionIds || []), event.sessionId]);
  const enterpriseIds = uniq([...(target.enterpriseIds || []), event.enterpriseId]);
  return {
    observed: true,
    observationCount: Number(target.observationCount || 0) + 1,
    scenarioIds,
    sessionIds,
    enterpriseIds,
    lastObserved: String(event.timestamp || target.lastObserved || '')
  };
}

export function correlateOdooRuntimeTrace(topology, trace) {
  const symbols = arr(topology?.symbols);
  const events = arr(trace?.events).filter((event) => event?.model && event?.method);
  let matchedEvents = 0;
  let matchedEdges = 0;

  const matchedBySeq = [];
  for (const event of events) {
    const matches = symbols.filter((symbol) => symbolMatchesEvent(symbol, event));
    if (matches.length) matchedEvents += 1;
    for (const symbol of matches) {
      symbol.runtimeEvidence = mergeEvidence(symbol.runtimeEvidence, event);
    }
    matchedBySeq.push({ event, matches });
  }

  for (let i = 0; i < matchedBySeq.length - 1; i += 1) {
    const current = matchedBySeq[i];
    const next = matchedBySeq[i + 1];
    if (current.event.sessionId && next.event.sessionId && current.event.sessionId !== next.event.sessionId) continue;
    const targetKey = eventKey(next.event);
    let linked = false;
    for (const source of current.matches) {
      for (const ref of arr(source.references)) {
        if (String(ref.relation || '') !== 'calls') continue;
        const target = symbols.find((symbol) => String(symbol.name || '').endsWith(`:${targetKey}`) && symbolMatchesEvent(symbol, next.event));
        if (!target || String(ref.name || '') !== String(target.name || '')) continue;
        ref.data = { ...(ref.data || {}), runtimeEvidence: mergeEvidence(ref.data?.runtimeEvidence, next.event) };
        linked = true;
      }
    }
    if (linked) matchedEdges += 1;
  }

  return {
    enterpriseIds: uniq(events.map((event) => event.enterpriseId)),
    scenarioIds: uniq(events.map((event) => event.scenarioId)),
    sessionIds: uniq(events.map((event) => event.sessionId)),
    eventCount: events.length,
    matchedEvents,
    matchedEdges
  };
}
