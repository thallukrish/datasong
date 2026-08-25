import { arr, key, text } from '../query_v2/modelJson.js';
import { leafEvidence } from '../query_v2/graphContext.js';

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

function linkedEntityState(entityName, join, hierarchy, index, semanticHints) {
  const entity = index.entities.get(key(entityName));
  const pathNode = arr(hierarchy.pathsByEntity.get(key(entityName)))[0];
  const node = pathNode ? hierarchy.byId.get(pathNode.pathId) : null;
  return {
    id:`link:${key(join.from)}:${key(join.to)}:${key(entityName)}`,
    canonicalId:node?.id || '',
    name:entity?.name || entityName,
    type:'entity',
    description:text(entity?.description, 180),
    entityName:entity?.name || entityName,
    edge:{ kind:'schema_fk', join },
    evidence:leafEvidence(entityName, index, semanticHints)
  };
}

export function rootStates(hierarchy) {
  return arr(hierarchy.clusters).map((node) => hierarchyState(node, { kind:'root' }));
}

export function expandState(state, { hierarchy, index, semanticHints, visitedEntityKeys = new Set() }) {
  const canonical = hierarchy.byId.get(state.canonicalId || state.id);
  const hierarchyChildren = arr(canonical?.children).map((node) => {
    const next = hierarchyState(node, { kind:'hierarchy', from:state.id, to:node.id });
    if (node.type === 'entity') next.evidence = leafEvidence(node.entityName, index, semanticHints);
    return next;
  });

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
      linked.push(linkedEntityState(step.to, join, hierarchy, index, semanticHints));
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
