import { arr, key, text } from './modelJson.js';

const ENTITY_DESC_MAX = 180;
const CLUSTER_DESC_MAX = 180;
const TOPIC_DESC_MAX = 150;

function entityNameParts(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function idPart(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'other';
}

function topicDescription(entityNames, graphEntities) {
  const descriptions = entityNames
    .map((name) => graphEntities.get(key(name))?.description)
    .filter(Boolean)
    .slice(0, 2)
    .map((value) => text(value, 70));
  return descriptions.length ? text(descriptions.join(' / '), TOPIC_DESC_MAX) : `Entity family containing ${entityNames.length} related names.`;
}

function makeTopicNode({ clusterId, parts, entries, graphEntities }) {
  const prefix = parts.join('');
  const id = `${clusterId}/topic:${parts.map(idPart).join('/')}`;
  const node = {
    id,
    type:'topic',
    name:`${prefix}*`,
    description:topicDescription(entries.map((entry) => entry.name), graphEntities),
    pathParts:parts,
    children:[]
  };

  const exact = entries.filter((entry) => entry.parts.length === parts.length);
  for (const entry of exact) {
    const entity = graphEntities.get(key(entry.name));
    node.children.push({
      id:`${id}/entity:${idPart(entry.name)}`,
      type:'entity',
      name:entry.name,
      description:text(entity?.description || '', ENTITY_DESC_MAX),
      entityName:entry.name,
      children:[]
    });
  }

  const grouped = new Map();
  for (const entry of entries.filter((item) => item.parts.length > parts.length)) {
    const next = entry.parts[parts.length];
    const k = key(next);
    if (!grouped.has(k)) grouped.set(k, { token:next, entries:[] });
    grouped.get(k).entries.push(entry);
  }

  for (const { token, entries:childEntries } of [...grouped.values()].sort((a, b) => a.token.localeCompare(b.token))) {
    node.children.push(makeTopicNode({ clusterId, parts:[...parts, token], entries:childEntries, graphEntities }));
  }
  return node;
}

function buildCluster(group, graphEntities) {
  const clusterId = `cluster:${idPart(group.name)}`;
  const entries = arr(group.members)
    .map((member) => graphEntities.get(key(member?.entity))?.name || String(member?.entity || ''))
    .filter(Boolean)
    .map((name) => ({ name, parts:entityNameParts(name) }))
    .filter((entry) => entry.parts.length);

  const grouped = new Map();
  for (const entry of entries) {
    const token = entry.parts[0];
    const k = key(token);
    if (!grouped.has(k)) grouped.set(k, { token, entries:[] });
    grouped.get(k).entries.push(entry);
  }

  const children = [...grouped.values()]
    .sort((a, b) => a.token.localeCompare(b.token))
    .map(({ token, entries:topicEntries }) => makeTopicNode({
      clusterId,
      parts:[token],
      entries:topicEntries,
      graphEntities
    }));

  return {
    id:clusterId,
    type:'cluster',
    name:String(group.name || ''),
    description:text(group.baseDescription || group.description || '', CLUSTER_DESC_MAX),
    children
  };
}

function indexTree(rootNodes) {
  const byId = new Map();
  const parentById = new Map();
  const pathsByEntity = new Map();

  const walk = (node, parent = null, path = []) => {
    byId.set(node.id, node);
    if (parent) parentById.set(node.id, parent.id);
    const nextPath = [...path, { id:node.id, type:node.type, name:node.name }];
    if (node.type === 'entity') {
      const k = key(node.entityName);
      if (!pathsByEntity.has(k)) pathsByEntity.set(k, []);
      pathsByEntity.get(k).push({ pathId:node.id, path:nextPath });
    }
    for (const child of arr(node.children)) walk(child, node, nextPath);
  };
  for (const root of rootNodes) walk(root);
  return { byId, parentById, pathsByEntity };
}

export function buildSemanticHierarchy(directory, graphEntities) {
  const clusters = arr(directory?.groups)
    .filter((group) => group?.name)
    .map((group) => buildCluster(group, graphEntities))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { clusters, ...indexTree(clusters) };
}

function filteredNode(node, allowedEntityKeys) {
  if (node.type === 'entity') return allowedEntityKeys.has(key(node.entityName)) ? { ...node, children:[] } : null;
  const children = arr(node.children).map((child) => filteredNode(child, allowedEntityKeys)).filter(Boolean);
  if (!children.length) return null;
  return { ...node, children };
}

export function filterHierarchyForEntities(hierarchy, entityNames) {
  const allowed = new Set(arr(entityNames).map(key));
  const clusters = arr(hierarchy?.clusters).map((node) => filteredNode(node, allowed)).filter(Boolean);
  return { clusters, ...indexTree(clusters) };
}

export function compactOptions(nodes) {
  return arr(nodes).map((node) => ({
    id:node.id,
    type:node.type,
    name:node.name,
    description:node.description
  }));
}

export function compactPath(path) {
  return arr(path).map((node) => ({ id:node.id, type:node.type, name:node.name }));
}
