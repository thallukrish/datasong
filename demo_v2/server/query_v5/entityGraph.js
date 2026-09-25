import { arr, key, text } from '../query_v2/modelJson.js';

function workflowById(workflows) {
  return new Map(arr(workflows).map(w => [String(w?.id || ''), w]));
}

function addEntity(map, name, source) {
  const clean = text(name,180);
  if (!clean) return;
  const k = key(clean);
  const existing = map.get(k) || { id:`entity:${k}`, name:clean, workflowIds:[], stageRefs:[] };
  if (source?.workflowId && !existing.workflowIds.includes(source.workflowId)) existing.workflowIds.push(source.workflowId);
  if (source?.stageRef && !existing.stageRefs.includes(source.stageRef)) existing.stageRefs.push(source.stageRef);
  map.set(k, existing);
}

function relationshipRows(workflow) {
  return arr(workflow?.relationshipDetails).map(rel => ({
    from:text(rel?.from,180),
    relation:text(rel?.relation,180),
    to:text(rel?.to,180),
    description:text(rel?.description,360),
    keyMaps:arr(rel?.keyMaps).slice(0,12),
    relationshipKind:text(rel?.relationshipKind,80),
    evidenced:arr(rel?.keyMaps).length > 0 || rel?.evidenced === true
  })).filter(rel => rel.from && rel.to);
}

export function deriveEntityGraphForEdge({ edge, workflowEvidence, workflows }) {
  const byId = workflowById(workflows);
  const entities = new Map();
  const relationships = [];
  const relSeen = new Set();

  for (const evidence of arr(workflowEvidence)) {
    const workflow = byId.get(String(evidence.workflowId));
    if (!workflow) continue;
    const selectedStages = arr(evidence.stageIndexes).map(i => arr(workflow.workflowSteps)[i]).filter(Boolean);
    const stageEntities = new Set();
    for (const [index, stage] of selectedStages.entries()) {
      const stageRef = `${workflow.id}:stage:${arr(evidence.stageIndexes)[index]}`;
      for (const name of [...arr(stage?.entities), ...arr(stage?.persistentObjects)]) {
        stageEntities.add(key(name));
        addEntity(entities, name, { workflowId:workflow.id, stageRef });
      }
    }
    // If the matched workflow did not expose explicit stage entities, retain its
    // declared entities so the missing stage-level binding remains visible.
    if (!stageEntities.size) {
      for (const name of [...arr(workflow.entities), ...arr(workflow.persistentObjects), ...arr(workflow.entityDetails).map(x => x?.name)]) {
        addEntity(entities, name, { workflowId:workflow.id });
        stageEntities.add(key(name));
      }
    }
    for (const rel of relationshipRows(workflow)) {
      if (!stageEntities.has(key(rel.from)) && !stageEntities.has(key(rel.to))) continue;
      addEntity(entities, rel.from, { workflowId:workflow.id });
      addEntity(entities, rel.to, { workflowId:workflow.id });
      const sig = `${key(rel.from)}|${key(rel.relation)}|${key(rel.to)}`;
      if (relSeen.has(sig)) continue;
      relSeen.add(sig);
      relationships.push({ id:`rel:${relSeen.size}`, ...rel, workflowId:workflow.id });
    }
  }

  const missing = [];
  if (!entities.size) missing.push('No entity representation found for matched workflow stages');
  const weakRelationships = relationships.filter(r => !r.evidenced);
  if (entities.size > 1 && !relationships.length) missing.push('No entity relationship found between matched workflow-stage entities');
  if (weakRelationships.length) missing.push(...weakRelationships.slice(0,6).map(r => `Join keys unresolved: ${r.from} → ${r.to}`));

  return {
    edgeId:edge.id,
    entities:[...entities.values()],
    relationships,
    missing:[...new Set(missing)]
  };
}
