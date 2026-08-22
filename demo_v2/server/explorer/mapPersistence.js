import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAP_VERSION = 3;
const arr = (value) => Array.isArray(value) ? value : [];
const clone = (value) => JSON.parse(JSON.stringify(value));
const safeName = (value) => crypto.createHash('sha1').update(String(value || '')).digest('hex');

function relationObjects(objects = {}) {
  return Object.values(objects).filter((object) => object?.type === 'relation');
}

export function graphFromSemanticObjects(objects = {}) {
  const linksByNode = new Map();
  for (const relation of relationObjects(objects)) {
    const fromId = relation?.properties?.fromId;
    const toId = relation?.properties?.toId;
    if (!fromId || !toId || !objects[fromId] || !objects[toId]) continue;
    if (!linksByNode.has(fromId)) linksByNode.set(fromId, []);
    linksByNode.get(fromId).push({
      nodeId: toId,
      relationship: relation.properties.relation || relation.name || 'related to',
      cardinality: relation.properties.cardinality || 'unknown',
      data: Object.fromEntries(Object.entries(relation.properties || {}).filter(([key]) => !['fromId', 'toId', 'relation', 'cardinality'].includes(key))),
      confidence: Number(relation.confidence || 0),
      evidence: clone(arr(relation.evidence))
    });
  }
  return Object.values(objects).filter((object) => object?.type !== 'relation').map((object) => ({
    id: object.id,
    type: object.type || 'concept',
    name: object.name || '',
    data: {
      ...(object.properties || {}),
      ...(arr(object.aliases).length ? { aliases: clone(object.aliases) } : {}),
      ...(object.scope ? { scope: object.scope } : {}),
      confidence: Number(object.confidence || 0),
      evidence: clone(arr(object.evidence))
    },
    links: linksByNode.get(object.id) || []
  }));
}

export function semanticObjectsFromGraph(graph = []) {
  const objects = {};
  for (const node of arr(graph)) {
    if (!node?.id) continue;
    const { aliases = [], scope = '', confidence = 0, evidence = [], ...properties } = node.data || {};
    objects[node.id] = {
      id: node.id, type: node.type || 'concept', name: node.name || '', aliases: clone(arr(aliases)), scope,
      properties: clone(properties), evidence: clone(arr(evidence)), confidence: Number(confidence || 0)
    };
  }
  for (const node of arr(graph)) {
    for (const [index, link] of arr(node?.links).entries()) {
      if (!node?.id || !link?.nodeId || !objects[link.nodeId]) continue;
      const relationship = link.relationship || 'related to';
      const id = `relation:${crypto.createHash('sha1').update(`${node.id}|${relationship}|${link.nodeId}|${index}`).digest('hex').slice(0, 16)}`;
      objects[id] = {
        id, type: 'relation', name: `${node.name || node.id} ${relationship} ${objects[link.nodeId].name || link.nodeId}`,
        aliases: [], scope: `${node.id}|${link.nodeId}`,
        properties: { fromId: node.id, toId: link.nodeId, relation: relationship, cardinality: link.cardinality || 'unknown', ...(link.data || {}) },
        evidence: clone(arr(link.evidence)), confidence: Number(link.confidence || 0)
      };
    }
  }
  return objects;
}

export function workflowArcsFromGraph(graph = []) {
  const nodes = new Map(arr(graph).filter((node) => node?.id).map((node) => [node.id, node]));
  const outgoing = (node, relationship) => arr(node?.links).filter((link) => !relationship || link.relationship === relationship).map((link) => nodes.get(link.nodeId)).filter(Boolean);
  return arr(graph).filter((node) => node?.type === 'workflow').map((workflow) => {
    const data = workflow.data || {};
    const entities = outgoing(workflow, 'uses entity');
    const steps = outgoing(workflow, 'contains step').sort((a, b) => Number(a?.data?.order || 0) - Number(b?.data?.order || 0));
    const callPathEvidence = arr(data.evidence).find((item) => item?.sourceType === 'call_path');
    const entityDetails = entities.map((entity) => ({
      name: entity.name,
      description: entity.data?.description || '',
      schemaResolved: !!entity.data?.schemaResolved,
      schemaName: entity.data?.schemaName || '',
      schemaSourcePath: entity.data?.schemaSourcePath || '',
      schemaComponent: entity.data?.schemaComponent || '',
      representedBy: clone(arr(entity.data?.representedBy)),
      fields: outgoing(entity, 'has field').map((field) => ({
        name: field.data?.fieldName || field.name,
        type: field.data?.dataType || '',
        isPk: !!field.data?.isPk,
        description: field.data?.description || '',
        sourceEntity: field.data?.sourceEntity || '',
        physicalFieldName: field.data?.physicalFieldName || ''
      }))
    }));
    const relationshipDetails = entities.flatMap((entity) => arr(entity.links)
      .filter((link) => !['has field'].includes(link.relationship) && nodes.get(link.nodeId)?.type === 'entity')
      .map((link) => ({ from: entity.name, relation: link.relationship, to: nodes.get(link.nodeId)?.name || '', description: link.data?.description || '' })));
    return {
      id: data.arcId || workflow.id,
      title: workflow.name,
      businessActor: data.actor || '',
      businessIntent: data.intent || '',
      trigger: data.trigger || '',
      outcome: data.outcome || '',
      businessOutcome: data.outcome || '',
      closureState: data.closureState || 'closed',
      progress: Number(data.progress ?? 100),
      status: 'broadly_complete',
      entities: entities.map((entity) => entity.name),
      entityDetails,
      workflowSteps: steps.map((step) => ({
        name: step.name,
        description: step.data?.description || '',
        effect: step.data?.effect || '',
        sourcePath: step.data?.sourcePath || '',
        entities: outgoing(step, 'touches entity').map((entity) => entity.name),
        persistentObjects: []
      })),
      relationshipDetails,
      relationships: relationshipDetails.map((item) => [item.from, item.relation, item.to].filter(Boolean).join(' → ')),
      traceability: callPathEvidence?.provenance || null,
      callPathId: callPathEvidence?.provenance?.callPathId || callPathEvidence?.source || ''
    };
  });
}

function compactLearningProgress(state = {}) {
  const incompleteArcs = arr(state.pass1Arcs).filter((arc) => arc?.closureState !== 'closed');
  return {
    incompleteArcs: clone(incompleteArcs),
    scheduler: {
      activeArcId: state.pass1Scheduler?.activeArcId || '',
      nextArcNumber: Number(state.pass1Scheduler?.nextArcNumber || 1)
    },
    scout: {
      reviewedCallPathIds: clone(arr(state.scout?.reviewedCallPathIds)),
      exhausted: !!state.scout?.exhausted
    }
  };
}

export const withMapPersistence = (Base) => class MapPersistenceExplorer extends Base {
  constructor(args) { super(args); this._mapRestoreAttempted = false; this._mapRestored = false; this._stoppedByUser = false; }

  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'learned-adjacency-graph-v3';
    state.mapPersistence = { restored: false, savedAt: '', repoUrl: '', commit: '', version: MAP_VERSION };
    state.stopRequested = false;
    return state;
  }

  mapDirectory() { return path.join(this.dataRoot, 'semantic-maps'); }
  mapFilePath(repoUrl = this.state?.repoUrl, commit = this.state?.commit) {
    if (!repoUrl || !commit) return '';
    return path.join(this.mapDirectory(), `${safeName(`${repoUrl}@${commit}`)}.json`);
  }

  restorePersistedMapIfAvailable() {
    if (this._mapRestoreAttempted) return this._mapRestored;
    if (!this.state?.repoUrl || !this.state?.commit) return false;
    this._mapRestoreAttempted = true;
    const file = this.mapFilePath();
    if (!file || !fs.existsSync(file)) return false;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (saved?.repoUrl !== this.state.repoUrl || saved?.commit !== this.state.commit) return false;
      if (Number(saved?.version || 0) === 2 && saved.semanticState) {
        for (const key of ['pass1Arcs','pass1Scheduler','pass2WholeFlowByArc','pass2GraphByArc','callPathPreprocess','scout','stories','threadAssignments','trajectoryEvidence','orientation','unattachedFragments','semanticObjects']) {
          if (saved.semanticState[key] !== undefined) this.state[key] = clone(saved.semanticState[key]);
        }
      } else if (Number(saved?.version || 0) === MAP_VERSION && Array.isArray(saved.graph)) {
        this.state.semanticObjects = semanticObjectsFromGraph(saved.graph);
        const completed = workflowArcsFromGraph(saved.graph);
        const completedIds = new Set(completed.map((arc) => arc.id));
        this.state.pass1Arcs = [...completed, ...clone(arr(saved.learningProgress?.incompleteArcs)).filter((arc) => !completedIds.has(arc?.id))];
        this.state.pass1Scheduler = { ...(this.state.pass1Scheduler || {}), ...(saved.learningProgress?.scheduler || {}) };
        this.state.scout = { ...(this.state.scout || {}), ...(saved.learningProgress?.scout || {}) };
      } else return false;
      this.state.mapPersistence = { restored: true, savedAt: saved.savedAt || '', repoUrl: saved.repoUrl, commit: saved.commit, version: Number(saved.version || MAP_VERSION) };
      this.state.lastMessage = 'Loaded the existing learned semantic graph for this repository revision.';
      this._mapRestored = true;
      return true;
    } catch (error) { console.warn(`[lemap] could not restore semantic map: ${error.message}`); return false; }
  }

  enrichTraceability() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      const callPathId = String(arc.callPathId || ''); if (!callPathId) continue;
      const grouped = this.rankedPathById?.(callPathId) || this.topology.topCallPaths?.(500)?.find((item) => item.id === callPathId) || null;
      if (!grouped) continue;
      const compact = this.compactCallPath?.(grouped) || null;
      arc.traceability = { callPathId, variantCallPathIds: arr(arc.callPathVariantIds), entrySymbolId: grouped.entrySymbolId || '', sourcePaths: arr(grouped.sourcePaths), pathFingerprint: crypto.createHash('sha1').update(JSON.stringify(compact || grouped)).digest('hex') };
    }
  }

  closeCompletedArcs() {
    for (const arc of arr(this.state?.pass1Arcs)) {
      const flow = this.state?.pass2WholeFlowByArc?.[arc.id]; if (!flow) continue;
      const noPendingBranches = arr(flow.pendingBranchIndexes).length === 0;
      const interpreted = Number(flow.wholeFlowCalls || 0) > 0 || Number(flow.branchCalls || 0) > 0;
      if ((flow.completed || (interpreted && noPendingBranches && Number(arc.progress || 0) >= 90)) && noPendingBranches) {
        arc.closureState = 'closed'; arc.closureReason = flow.completed ? 'compressed flow fully interpreted' : 'high-confidence flow with no unresolved branches';
        arc.closedAt = arc.closedAt || new Date().toISOString(); arc.progress = 100;
        if (arc.status !== 'unresolved') arc.status = 'broadly_complete'; arc.opportunityScore = 0;
      }
    }
  }

  persistSemanticMap() {
    if (!this.state?.repoUrl || !this.state?.commit) return;
    try {
      this.closeCompletedArcs(); this.enrichTraceability(); fs.mkdirSync(this.mapDirectory(), { recursive: true });
      const savedAt = new Date().toISOString();
      const learnedMap = { version: MAP_VERSION, repoUrl: this.state.repoUrl, commit: this.state.commit, savedAt, graph: graphFromSemanticObjects(this.state.semanticObjects), learningProgress: compactLearningProgress(this.state) };
      fs.writeFileSync(this.mapFilePath(), JSON.stringify(learnedMap, null, 2));
      this.state.mapPersistence = { restored: !!this._mapRestored, savedAt, repoUrl: this.state.repoUrl, commit: this.state.commit, version: MAP_VERSION };
    } catch (error) { console.warn(`[lemap] could not persist semantic map: ${error.message}`); }
  }

  emit() {
    if (this.state?.repoUrl && this.state?.commit && !this._mapRestoreAttempted) this.restorePersistedMapIfAvailable();
    if (this._stoppedByUser && this.state?.status === 'complete') this.state.lastMessage = 'Stopped by user. The learned graph has been saved.';
    this.closeCompletedArcs(); this.enrichTraceability(); if (this.state?.repoUrl && this.state?.commit) this.persistSemanticMap(); return super.emit();
  }
  applyDelta(parsed, observation) { const result = super.applyDelta(parsed, observation); this.closeCompletedArcs(); this.enrichTraceability(); this.persistSemanticMap(); return result; }
  requestStop() { this._stoppedByUser = true; this.state.stopRequested = true; this.state.lastMessage = 'Stopping after the current reasoning step…'; this.persistSemanticMap(); super.emit(); }
  async resolveNextAction(action, candidates) { if (this.state?.stopRequested) return null; return super.resolveNextAction(action, candidates); }
};
