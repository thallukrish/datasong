const arr = (value) => Array.isArray(value) ? value : [];
const clone = (value) => JSON.parse(JSON.stringify(value));

function compactCallPathEvidence(evidence) {
  const item = arr(evidence).find((entry) => entry?.sourceType === 'call_path');
  if (!item) return [];
  const provenance = item.provenance && typeof item.provenance === 'object' ? item.provenance : {};
  return [{
    sourceType: 'call_path',
    source: String(item.source || provenance.callPathId || ''),
    provenance: {
      callPathId: String(provenance.callPathId || item.source || ''),
      variantCallPathIds: arr(provenance.variantCallPathIds).map(String),
      entrySymbolId: String(provenance.entrySymbolId || ''),
      sourcePaths: arr(provenance.sourcePaths).slice(0, 6).map(String),
      pathFingerprint: String(provenance.pathFingerprint || '')
    }
  }];
}

export function compactGraph(graph = []) {
  return arr(graph).map((node) => {
    const data = { ...(node?.data || {}) };
    const workflowEvidence = node?.type === 'workflow' ? compactCallPathEvidence(data.evidence) : [];
    delete data.evidence;
    if (workflowEvidence.length) data.evidence = workflowEvidence;

    return {
      id: node?.id,
      type: node?.type,
      name: node?.name || '',
      data,
      links: arr(node?.links).map((link) => {
        const out = {
          nodeId: link?.nodeId,
          relationship: link?.relationship || 'related to',
          cardinality: link?.cardinality || 'unknown',
          data: { ...(link?.data || {}) },
          confidence: Number(link?.confidence || 0)
        };
        return out;
      })
    };
  }).filter((node) => node.id);
}

export function compactIncompleteArc(arc = {}) {
  return {
    id: String(arc.id || ''),
    title: String(arc.title || ''),
    businessActor: String(arc.businessActor || ''),
    businessIntent: String(arc.businessIntent || ''),
    trigger: String(arc.trigger || ''),
    outcome: String(arc.outcome || arc.businessOutcome || ''),
    progress: Number(arc.progress || 0),
    status: String(arc.status || 'forming'),
    closureState: String(arc.closureState || ''),
    callPathId: String(arc.callPathId || arc.traceability?.callPathId || ''),
    callPathVariantIds: arr(arc.callPathVariantIds || arc.traceability?.variantCallPathIds).map(String),
    containedCallPathIds: arr(arc.containedCallPathIds).map(String),
    relatedCallPathIds: arr(arc.relatedCallPathIds).map(String),
    seedArtifactId: String(arc.seedArtifactId || ''),
    seedSourcePath: String(arc.seedSourcePath || ''),
    seedSource: String(arc.seedSource || ''),
    businessPriority: Number.isFinite(Number(arc.businessPriority)) ? Number(arc.businessPriority) : null,
    priorityClass: String(arc.priorityClass || ''),
    priorityModelVersion: String(arc.priorityModelVersion || ''),
    majorStages: arr(arc.majorStages).map(String),
    entities: arr(arc.entities).map(String),
    persistentObjects: arr(arc.persistentObjects).map(String),
    relationships: arr(arc.relationships).map(String),
    externalEffects: arr(arc.externalEffects).map(String),
    entityRepresentations: clone(arr(arc.entityRepresentations)),
    workflowSteps: arr(arc.workflowSteps).map((step) => ({
      name: String(step?.name || ''),
      description: String(step?.description || ''),
      effect: String(step?.effect || ''),
      sourcePath: String(step?.sourcePath || ''),
      entities: arr(step?.entities).map(String),
      persistentObjects: arr(step?.persistentObjects).map(String)
    }))
  };
}

export function compactLearningProgress(input = {}) {
  const arcs = input.pass1Arcs || input.incompleteArcs || [];
  const scheduler = input.pass1Scheduler || input.scheduler || {};
  const scout = input.scout || {};
  return {
    incompleteArcs: arr(arcs).filter((arc) => arc?.closureState !== 'closed').map(compactIncompleteArc),
    scheduler: {
      activeArcId: String(scheduler.activeArcId || ''),
      nextArcNumber: Number(scheduler.nextArcNumber || 1)
    },
    scout: {
      reviewedCallPathIds: arr(scout.reviewedCallPathIds).map(String),
      exhausted: !!scout.exhausted
    }
  };
}

export function compactPersistedMap(saved = {}) {
  if (!Array.isArray(saved.graph)) throw new Error('Persisted map does not contain a graph');
  return {
    version: Number(saved.version || 3),
    format: 'compact-v1',
    repoUrl: String(saved.repoUrl || ''),
    commit: String(saved.commit || ''),
    savedAt: String(saved.savedAt || new Date().toISOString()),
    graph: compactGraph(saved.graph),
    learningProgress: compactLearningProgress(saved.learningProgress || {})
  };
}
