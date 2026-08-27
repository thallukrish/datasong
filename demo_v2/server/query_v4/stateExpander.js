import { arr, key, text } from '../query_v2/modelJson.js';
import { leafEvidence } from '../query_v2/graphContext.js';

function schemaFields(entity) {
  return arr(entity?.fields).map((field) => ({
    name:text(field?.name, 120),
    type:text(field?.type, 60),
    isPk:!!field?.isPk,
    description:text(field?.description, 180)
  })).filter((field) => field.name);
}

function hierarchyState(node, edge = null) {
  return {
    id:node.id,
    name:node.name,
    type:node.type,
    description:text(node.description, 180),
    entityName:node.entityName || '',
    edge
  };
}

function groundEntityState(state, entityName, index, semanticHints) {
  const entity = index.entities.get(key(entityName));
  if (!entity) return null;
  return {
    ...state,
    name:entity.name || state.name,
    entityName:entity.name || entityName,
    evidence:leafEvidence(entityName, index, semanticHints),
    schemaFields:schemaFields(entity)
  };
}

function linkedEntityState(entityName, join, hierarchy, index, semanticHints) {
  const entity = index.entities.get(key(entityName));
  const pathNode = arr(hierarchy.pathsByEntity.get(key(entityName)))[0];
  const node = pathNode ? hierarchy.byId.get(pathNode.pathId) : null;
  return groundEntityState({
    id:`link:${key(join.from)}:${key(join.to)}:${key(entityName)}`,
    canonicalId:node?.id || '',
    name:entity?.name || entityName,
    type:'entity',
    description:text(entity?.description, 180),
    entityName:entity?.name || entityName,
    edge:{ kind:'schema_fk', join }
  }, entityName, index, semanticHints);
}

function workflowEntityNames(workflow) {
  const names = new Set();
  for (const name of arr(workflow?.entities)) if (name) names.add(String(name));
  for (const name of arr(workflow?.persistentObjects)) if (name) names.add(String(name));
  for (const item of arr(workflow?.entityDetails)) if (item?.name) names.add(String(item.name));
  for (const step of arr(workflow?.workflowSteps)) {
    for (const name of arr(step?.entities)) if (name) names.add(String(name));
    for (const name of arr(step?.persistentObjects)) if (name) names.add(String(name));
  }
  return [...names];
}

function workflowDescription(workflow) {
  return text([
    workflow?.businessIntent,
    workflow?.businessOutcome || workflow?.outcome,
    workflow?.businessActor ? `Actor: ${workflow.businessActor}` : ''
  ].filter(Boolean).join(' | '), 360);
}

export function rootStates(hierarchy, workflows = []) {
  const workflowRoots = arr(workflows).map((workflow) => ({
    id:`workflow:${workflow.id}`,
    name:workflow.title || workflow.businessIntent || workflow.id,
    type:'workflow',
    description:workflowDescription(workflow),
    workflowId:workflow.id,
    workflowEntities:workflowEntityNames(workflow),
    edge:{ kind:'root', source:'workflow' }
  })).filter((state) => state.workflowEntities.length);

  const clusterRoots = arr(hierarchy.clusters).map((node) => ({
    ...hierarchyState(node, { kind:'root', source:'directory' }),
    seedSource:'directory'
  }));

  return [...workflowRoots, ...clusterRoots];
}

export function expandState(state, { hierarchy, index, semanticHints, visitedEntityKeys = new Set() }) {
  if (state?.type === 'workflow') {
    const seen = new Set();
    return arr(state.workflowEntities).map((entityName) => {
      const k = key(entityName);
      if (!k || visitedEntityKeys.has(k) || seen.has(k) || !index.entities.has(k)) return null;
      seen.add(k);
      const entity = index.entities.get(k);
      const pathNode = arr(hierarchy.pathsByEntity.get(k))[0];
      const node = pathNode ? hierarchy.byId.get(pathNode.pathId) : null;
      return groundEntityState({
        id:`workflow-entity:${key(state.workflowId)}:${k}`,
        canonicalId:node?.id || '',
        name:entity?.name || entityName,
        type:'entity',
        description:text(entity?.description, 180),
        entityName:entity?.name || entityName,
        edge:{ kind:'workflow_member', workflowId:state.workflowId, from:state.id, to:k }
      }, entityName, index, semanticHints);
    }).filter(Boolean);
  }

  const canonical = hierarchy.byId.get(state.canonicalId || state.id);
  const hierarchyChildren = arr(canonical?.children).map((node) => {
    const next = hierarchyState(node, { kind:'hierarchy', from:state.id, to:node.id });
    return node.type === 'entity'
      ? groundEntityState(next, node.entityName, index, semanticHints)
      : next;
  }).filter(Boolean);

  const linked = [];
  const entityName = state.entityName || canonical?.entityName || '';
  if (entityName) {
    for (const step of arr(index.adjacency.get(key(entityName)))) {
      if (visitedEntityKeys.has(key(step.to))) continue;
      const join = {
        from:step.edge.from,
        to:step.edge.to,
        relationship:step.edge.relationship,
        cardinality:step.edge.cardinality,
        keyMaps:step.edge.keyMaps,
        evidenced:true
      };
      const linkedState = linkedEntityState(step.to, join, hierarchy, index, semanticHints);
      if (linkedState) linked.push(linkedState);
    }
  }

  const seen = new Set();
  return [...hierarchyChildren, ...linked].filter((item) => {
    const sig = `${item.type}:${key(item.entityName || item.name)}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}
