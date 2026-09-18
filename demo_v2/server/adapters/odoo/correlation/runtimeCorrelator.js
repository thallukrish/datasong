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

function buildSymbolIndex(symbols) {
  const byEventKey = new Map();
  for (const symbol of symbols) {
    const meta = symbol?.odooExecution || {};
    if (!meta.modelName || !meta.methodName) continue;
    const key = `${String(meta.modelName)}.${String(meta.methodName)}`;
    if (!byEventKey.has(key)) byEventKey.set(key, []);
    byEventKey.get(key).push(symbol);
  }
  return byEventKey;
}

function indexedMatches(index, event) {
  return arr(index.get(eventKey(event))).filter((symbol) => symbolMatchesEvent(symbol, event));
}

export function correlateOdooRuntimeTrace(topology, trace) {
  const symbols = arr(topology?.symbols);
  const events = arr(trace?.events).filter((event) => event?.model && event?.method);
  const symbolIndex = buildSymbolIndex(symbols);
  let matchedEvents = 0;
  let matchedEdges = 0;

  const matchedBySeq = [];
  for (const event of events) {
    const matches = indexedMatches(symbolIndex, event);
    if (matches.length) matchedEvents += 1;
    for (const symbol of matches) {
      symbol.runtimeEvidence = mergeEvidence(symbol.runtimeEvidence, event);
    }
    matchedBySeq.push({ event, matches });
  }

  const annotateEdge = (sourceMatches, targetEvent, targetMatches) => {
    let linked = false;
    const targetByName = new Set(targetMatches.map((candidate) => String(candidate?.name || '')));
    if (!targetByName.size) return false;

    for (const source of sourceMatches) {
      for (const ref of arr(source.references)) {
        if (String(ref.relation || '') !== 'calls') continue;
        if (!targetByName.has(String(ref.name || ''))) continue;
        ref.data = { ...(ref.data || {}), runtimeEvidence: mergeEvidence(ref.data?.runtimeEvidence, targetEvent) };
        linked = true;
      }
    }
    return linked;
  };

  for (let i = 0; i < matchedBySeq.length; i += 1) {
    const current = matchedBySeq[i];
    const callerEvent = current.event?.callerModel && current.event?.callerMethod
      ? {
          model: current.event.callerModel,
          method: current.event.callerMethod,
          enterpriseId: current.event.enterpriseId,
          scenarioId: current.event.scenarioId,
          sessionId: current.event.sessionId
        }
      : null;
    const callerMatches = callerEvent ? indexedMatches(symbolIndex, callerEvent) : [];

    let linked = callerMatches.length
      ? annotateEdge(callerMatches, current.event, current.matches)
      : false;

    if (!linked && i > 0) {
      const previous = matchedBySeq[i - 1];
      const sameSession = !previous.event.sessionId || !current.event.sessionId
        || previous.event.sessionId === current.event.sessionId;
      if (sameSession) linked = annotateEdge(previous.matches, current.event, current.matches);
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
