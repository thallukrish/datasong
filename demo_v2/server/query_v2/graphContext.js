import { arr, key, text } from './modelJson.js';

const ENTITY_DESC_MAX = 180;
const FIELD_DESC_MAX = 100;
const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','can','for','from','has','have','in','is','it','its','of','on','or','that','the','their','this','to','used','using','was','were','which','with',
  'field','fields','entity','record','records','value','values','identifier','identifies','identification','description','type','types','code','codes','date','time'
]);

function naturalWords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

export function buildGraphIndex(graph = []) {
  const nodes = new Map(arr(graph).filter((node) => node?.id).map((node) => [String(node.id), node]));
  const entities = new Map();
  const entityNameById = new Map();

  for (const node of nodes.values()) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const name = String(node.name);
    entities.set(key(name), { name, description:text(node.data?.description, ENTITY_DESC_MAX), fields:[] });
    entityNameById.set(String(node.id), name);
  }

  for (const node of nodes.values()) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const entity = entities.get(key(node.name));
    for (const link of arr(node.links)) {
      if (String(link?.relationship || '') !== 'has field') continue;
      const fieldNode = nodes.get(String(link?.nodeId || ''));
      if (fieldNode?.type !== 'field') continue;
      const name = text(fieldNode.data?.physicalFieldName || fieldNode.data?.fieldName || String(fieldNode.name || '').split('.').at(-1), 120);
      if (!name || entity.fields.some((field) => key(field.name) === key(name))) continue;
      entity.fields.push({
        name,
        type:text(fieldNode.data?.dataType, 60),
        isPk:!!fieldNode.data?.isPk,
        description:text(fieldNode.data?.description, 220)
      });
    }
  }

  const relationships = [];
  const seen = new Set();
  for (const node of nodes.values()) {
    if (node?.type !== 'entity') continue;
    for (const link of arr(node.links)) {
      if (link?.data?.relationshipKind !== 'schema_fk' || link?.data?.evidenced === false) continue;
      const from = entityNameById.get(String(node.id));
      const to = entityNameById.get(String(link?.nodeId || ''));
      if (!from || !to) continue;
      const keyMaps = arr(link?.data?.keyMaps).map((item) => ({
        fieldName:text(item?.fieldName, 120),
        relatedFieldName:text(item?.relatedFieldName, 120),
        implicit:!!item?.implicit
      })).filter((item) => item.fieldName || item.relatedFieldName);
      const sig = `${key(from)}|${key(to)}|${key(link.relationship)}|${keyMaps.map((m) => `${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      relationships.push({
        from,
        to,
        relationship:text(link?.relationship || 'related to', 120),
        cardinality:text(link?.cardinality || 'unknown', 60),
        keyMaps,
        evidenced:true
      });
    }
  }

  const adjacency = new Map();
  const add = (from, to, edge) => {
    const k = key(from);
    if (!adjacency.has(k)) adjacency.set(k, []);
    adjacency.get(k).push({ from, to, edge });
  };
  for (const edge of relationships) {
    add(edge.from, edge.to, edge);
    add(edge.to, edge.from, edge);
  }

  return { entities, relationships, adjacency };
}

export function buildSemanticFieldHints(entities) {
  const docs = new Map();
  const df = new Map();
  const all = [...entities.values()];

  for (const entity of all) {
    const counts = new Map();
    const evidence = new Map();
    for (const field of arr(entity.fields)) {
      const description = text(field.description, 220);
      if (!description) continue;
      for (const word of naturalWords(description)) {
        counts.set(word, (counts.get(word) || 0) + 1);
        if (!evidence.has(word)) evidence.set(word, { field:field.name, description });
      }
    }
    docs.set(key(entity.name), { counts, evidence });
    for (const word of counts.keys()) df.set(word, (df.get(word) || 0) + 1);
  }

  const n = Math.max(all.length, 1);
  const result = new Map();
  for (const entity of all) {
    const doc = docs.get(key(entity.name)) || { counts:new Map(), evidence:new Map() };
    const total = [...doc.counts.values()].reduce((sum, count) => sum + count, 0) || 1;
    const scored = [];
    for (const [word, count] of doc.counts) {
      const tf = count / total;
      const idf = Math.log((n + 1) / ((df.get(word) || 0) + 1)) + 1;
      const ev = doc.evidence.get(word) || {};
      scored.push({ term:word, score:Number((tf * idf).toFixed(4)), field:ev.field || '', description:text(ev.description || '', FIELD_DESC_MAX) });
    }
    scored.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
    result.set(key(entity.name), scored.slice(0, 5));
  }
  return result;
}

function joinEvidence(step) {
  const edge = step.edge;
  return {
    from:edge.from,
    to:edge.to,
    relationship:edge.relationship,
    cardinality:edge.cardinality,
    keyMaps:edge.keyMaps,
    evidenced:true
  };
}

export function leafEvidence(entityName, index, semanticHints) {
  const entity = index.entities.get(key(entityName));
  if (!entity) return null;
  return {
    entity:{ name:entity.name, description:text(entity.description, ENTITY_DESC_MAX) },
    semanticFields:arr(semanticHints.get(key(entity.name))).map((hint) => ({
      field:hint.field,
      term:hint.term,
      score:hint.score,
      description:text(hint.description, FIELD_DESC_MAX)
    }))
  };
}

export function linkedNeighbours(entityName, index, { blockedEntityKeys = new Set() } = {}) {
  const byEntity = new Map();
  const connections = [];
  for (const step of arr(index.adjacency.get(key(entityName)))) {
    const targetKey = key(step.to);
    const join = joinEvidence(step);
    if (blockedEntityKeys.has(targetKey)) {
      connections.push({ entity:step.to, join });
      continue;
    }
    if (!byEntity.has(targetKey)) byEntity.set(targetKey, { entity:step.to, joins:[] });
    byEntity.get(targetKey).joins.push(join);
  }
  return { eligible:[...byEntity.values()], connections };
}

export function acceptedGraph(accepted, traversedJoins, index) {
  const joins = [...traversedJoins.values()];
  const entities = [...accepted.values()].map((acceptedItem) => {
    const entity = index.entities.get(key(acceptedItem.entity));
    if (!entity) return null;
    return {
      name:entity.name,
      description:text(entity.description, ENTITY_DESC_MAX),
      selectAllFields:true
    };
  }).filter(Boolean);
  return { entities, joins };
}
