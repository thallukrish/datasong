const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 220) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);

function compactArtifact(artifact = {}) {
  return {
    id:text(artifact?.id, 180),
    path:text(artifact?.path || artifact?.sourcePath, 220),
    kind:text(artifact?.kind || artifact?.symbolKind, 80),
    label:text(artifact?.label || artifact?.symbolName || artifact?.summary, 180)
  };
}

function compactDecision(parsed = {}) {
  return {
    semanticRole:text(parsed?.semanticRole, 60),
    meaning:text(parsed?.meaning, 320),
    pathId:text(parsed?.pathId || parsed?.bestThread, 160),
    pathTitle:text(parsed?.pathTitle || parsed?.newThread?.title, 180),
    relation:text(parsed?.relation, 80),
    bridge:text(parsed?.bridge, 320),
    closes:text(parsed?.closes, 60),
    openQuestion:text(parsed?.openQuestion, 240),
    next:parsed?.next || parsed?.evidenceRequest || null
  };
}

function workflowSummary(state = {}) {
  const workflows = arr(state?.pass1Arcs);
  const activeId = String(state?.pass1Scheduler?.activeArcId || '');
  const active = workflows.find((arc) => String(arc?.id || '') === activeId) || null;
  const closed = workflows.filter((arc) => arc?.closureState === 'closed').length;
  const zero = workflows.filter((arc) => arc?.closureState !== 'closed' && Number(arc?.progress || 0) === 0).length;
  return {
    total:workflows.length,
    closed,
    incomplete:Math.max(0, workflows.length - closed),
    zeroProgress:zero,
    activeArcId:activeId,
    active:active ? {
      id:text(active.id, 160),
      title:text(active.title, 200),
      progress:Number(active.progress || 0),
      closureState:text(active.closureState, 60),
      status:text(active.status, 80)
    } : null,
    status:text(state?.status, 60),
    step:Number(state?.step || 0),
    lastMessage:text(state?.lastMessage, 320)
  };
}

function compactRecord(record = {}) {
  if (!record || typeof record !== 'object') return record;

  // llm_attempt is duplicated by llm_call_applied on success. Keep attempts only
  // when a later parse/validation error records the raw response.
  if (record.type === 'llm_attempt') return null;

  if (record.type === 'llm_call_applied') {
    return {
      type:record.type,
      timestamp:record.timestamp,
      call:record.call,
      explorationStep:record.explorationStep,
      retry:!!record.retry,
      observedArtifact:compactArtifact(record.observedArtifact),
      decision:compactDecision(record.parsedResponse),
      workflow:workflowSummary(record.semanticBoardAfter),
      finishReason:record.finishReason || '',
      usage:record.usage || {},
      cumulativeUsage:record.cumulativeUsage || {}
    };
  }

  if (record.type === 'run_complete') {
    return {
      type:record.type,
      timestamp:record.timestamp,
      reason:record.reason || '',
      workflow:workflowSummary(record.state),
      story:record.story ? {
        id:text(record.story?.id, 160),
        title:text(record.story?.title, 200),
        progress:Number(record.story?.progress || 0),
        status:text(record.story?.status, 80)
      } : undefined
    };
  }

  const errorEvent = ['llm_parse_error', 'llm_invalid_delta'].includes(record.type);
  const out = { ...record };
  delete out.semanticBoardBefore;
  delete out.semanticBoardAfter;
  delete out.systemPrompt;
  delete out.prompt;
  delete out.candidates;
  if (out.observedArtifact) out.observedArtifact = compactArtifact(out.observedArtifact);
  if (out.state) {
    out.workflow = workflowSummary(out.state);
    delete out.state;
  }
  if (!errorEvent) delete out.rawResponse;
  else if (out.rawResponse) out.rawResponse = String(out.rawResponse).slice(0, 6000);
  return out;
}

function printProgress(compact) {
  if (compact?.type !== 'llm_call_applied') return;
  const workflow = compact.workflow || {};
  const active = workflow.active;
  const activeText = active ? `${active.title || active.id} ${active.progress}%` : 'none';
  const next = compact.decision?.next?.type || '—';
  console.log(`[lemap learn #${compact.explorationStep}] active: ${activeText} | closed ${workflow.closed || 0}/${workflow.total || 0} | incomplete ${workflow.incomplete || 0} | at 0% ${workflow.zeroProgress || 0} | next ${next}`);
}

export const withCompactRunLogging = (Base) => class CompactRunLoggingExplorer extends Base {
  async appendRunLog(record) {
    const compact = compactRecord(record);
    if (!compact) return;
    printProgress(compact);
    return super.appendRunLog(compact);
  }
};
