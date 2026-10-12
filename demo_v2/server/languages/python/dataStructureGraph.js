import crypto from 'node:crypto';

const arr = (value) => Array.isArray(value) ? value : [];
const uniq = (values) => [...new Set(arr(values).filter(Boolean))].sort();
const norm = (value) => String(value || '').trim().toLowerCase();

function leaf(value) {
  const parts = String(value || '').split(/[.:/]/).filter(Boolean);
  return parts.at(-1) || '';
}

function originNames(observation) {
  return uniq(arr(observation?.origins).map((origin) => origin?.name).filter(Boolean));
}

function canonicalTypeIdentity(value) {
  const raw = norm(value).replace(/\s+/g, '');
  if (!raw) return '';

  // Keep qualified names when present so unrelated classes with the same leaf
  // name do not collapse. For simple annotations/constructors, the normalized
  // name is already a stable type identity.
  return raw;
}

function globalIdentity(observation) {
  const annotation = canonicalTypeIdentity(observation?.annotation);
  if (annotation) return `type:${annotation}`;

  const constructors = arr(observation?.origins)
    .filter((origin) => origin?.kind === 'constructed' && origin?.name)
    .map((origin) => canonicalTypeIdentity(origin.name))
    .filter(Boolean);
  if (constructors.length) return `type:${uniq(constructors).join('|')}`;

  // A mapping with multiple stable keys is useful structural evidence across
  // functions (for example a record passed through a pipeline). One-key
  // dictionaries are too weak and stay scope-local.
  const keys = uniq(observation?.keys).map(norm);
  if (String(observation?.kind || '') === 'mapping' && keys.length >= 2) {
    return `mapping-keys:${keys.join('|')}`;
  }

  return '';
}

function scopeIdentity(observation) {
  const functionId = String(observation?.functionId || '').trim();
  const variable = norm(observation?.variable);
  return `scope:${functionId}:${variable || '<anonymous>'}`;
}

function mergeCluster(cluster, observation) {
  cluster.observations.push(observation);
  cluster.aliases.add(observation.variable);
  cluster.functionIds.add(observation.functionId);
  for (const value of observation.members || []) cluster.members.add(value);
  for (const value of observation.methods || []) cluster.methods.add(value);
  for (const value of observation.keys || []) cluster.keys.add(value);
  for (const value of originNames(observation)) cluster.origins.add(value);
  if (observation.annotation) cluster.annotations.add(observation.annotation);
}

export function clusterPythonDataStructures(observations = []) {
  const clusters = [];
  const byIdentity = new Map();

  for (const observation of arr(observations)) {
    // Cross-function merging is allowed only with strong deterministic
    // identity. Ordinary locals are isolated by lexical function scope.
    const globalKey = globalIdentity(observation);
    const identityKey = globalKey || scopeIdentity(observation);

    let cluster = byIdentity.get(identityKey) || null;
    if (!cluster) {
      cluster = {
        strongKey: globalKey,
        identityKey,
        identityScope: globalKey ? 'global' : 'function',
        kind: observation.kind || 'object',
        prototype: observation,
        observations: [],
        aliases: new Set(),
        functionIds: new Set(),
        members: new Set(),
        methods: new Set(),
        keys: new Set(),
        origins: new Set(),
        annotations: new Set()
      };
      clusters.push(cluster);
      byIdentity.set(identityKey, cluster);
    }

    mergeCluster(cluster, observation);
  }

  return clusters;
}

function entityId(cluster) {
  const fingerprint = [
    cluster.identityKey || cluster.strongKey,
    cluster.kind,
    [...cluster.annotations].sort().join(','),
    [...cluster.origins].sort().join(','),
    [...cluster.members].sort().join(','),
    [...cluster.keys].sort().join(',')
  ].join('|');
  return `entity:${crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 12)}`;
}

function entityName(cluster) {
  const annotation = [...cluster.annotations][0];
  if (annotation) return annotation;
  const origin = [...cluster.origins].find((value) => value && !['dict', 'list', 'set', 'tuple'].includes(value));
  if (origin) return leaf(origin);
  const aliases = [...cluster.aliases].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return aliases[0] || cluster.kind || 'entity';
}

function innermostRegion(symbol, line) {
  if (!symbol || !line) return null;
  const candidates = arr(symbol.regions).filter((region) =>
    Number(region?.startLine || 0) <= line && line <= Number(region?.endLine || 0)
  );
  candidates.sort((a, b) => {
    const aspan = Number(a?.endLine || 0) - Number(a?.startLine || 0);
    const bspan = Number(b?.endLine || 0) - Number(b?.startLine || 0);
    return aspan - bspan || Number(b?.startLine || 0) - Number(a?.startLine || 0);
  });
  return candidates[0] || null;
}

function eventRelationship(event) {
  const op = String(event?.operation || '');
  if (op === 'create') return 'create';
  if (op === 'mutate' || op === 'write') return 'update';
  if (op === 'read' || op === 'index') return 'read';
  return '';
}

function canonicalEvents(observation) {
  const events = arr(observation?.events);
  const createLines = new Set(events.filter((event) => event?.operation === 'create').map((event) => Number(event?.line || 0)));
  const seen = new Set();
  const out = [];

  for (const event of events) {
    const relationship = eventRelationship(event);
    if (!relationship) continue;
    const line = Number(event?.line || 0);
    if (relationship === 'update' && createLines.has(line)) continue;
    const key = `${relationship}:${line}:${Number(event?.endLine || line)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...event, relationship });
  }
  return out;
}

function addLink(node, id, relationship) {
  if (!node || !id || !relationship) return;
  node.links = arr(node.links);
  if (!node.links.some((link) => link.id === id && link.relationship === relationship)) {
    node.links.push({ id, relationship });
  }
}

export function buildPythonDataStructureGraph({ symbols = [], observations = [] } = {}) {
  const clusters = clusterPythonDataStructures(observations);
  const nodes = [];
  const nodeById = new Map();
  const symbolById = new Map(arr(symbols).map((symbol) => [symbol.id, symbol]));

  for (const symbol of arr(symbols)) {
    const functionNode = {
      id: symbol.id,
      type: 'function',
      details: {
        name: symbol.name,
        sourcePath: symbol.sourcePath,
        startLine: Number(symbol.startLine || 0),
        endLine: Number(symbol.endLine || 0)
      },
      links: []
    };
    nodes.push(functionNode);
    nodeById.set(functionNode.id, functionNode);

    for (const region of arr(symbol.regions)) {
      const regionNode = {
        id: region.id,
        type: 'function-region',
        details: {
          name: `${symbol.name} ${region.kind || 'region'}`,
          functionId: symbol.id,
          kind: region.kind || '',
          sourcePath: symbol.sourcePath,
          startLine: Number(region.startLine || 0),
          endLine: Number(region.endLine || 0)
        },
        links: []
      };
      nodes.push(regionNode);
      nodeById.set(regionNode.id, regionNode);
      addLink(functionNode, regionNode.id, 'contains');
      addLink(regionNode, symbol.id, 'contained-by');
    }
  }

  for (const symbol of arr(symbols)) {
    const fn = nodeById.get(symbol.id);
    for (const ref of arr(symbol.references)) {
      if (ref?.relation === 'calls' && ref?.targetSymbolId && nodeById.has(ref.targetSymbolId)) {
        addLink(fn, ref.targetSymbolId, 'calls');
      }
    }
  }

  const entityLinks = [];

  for (const cluster of clusters) {
    const id = entityId(cluster);
    const functionCount = cluster.functionIds.size;
    const flowEdges = new Set();

    for (const symbol of arr(symbols)) {
      if (!cluster.functionIds.has(symbol.id)) continue;
      for (const ref of arr(symbol.references)) {
        if (ref?.relation === 'calls' && ref?.targetSymbolId && cluster.functionIds.has(ref.targetSymbolId)) {
          flowEdges.add(`${symbol.id}->${ref.targetSymbolId}`);
        }
      }
    }

    const entityNode = {
      id,
      type: 'entity',
      details: {
        name: entityName(cluster),
        kind: cluster.kind,
        identityScope: cluster.identityScope || 'function',
        identityKey: cluster.identityKey || '',
        functionCount,
        flowEdgeCount: flowEdges.size,
        coreScore: functionCount + flowEdges.size,
        aliases: [...cluster.aliases].sort(),
        annotations: [...cluster.annotations].sort(),
        origins: [...cluster.origins].sort(),
        members: [...cluster.members].sort(),
        methods: [...cluster.methods].sort(),
        keys: [...cluster.keys].sort()
      },
      links: []
    };

    nodes.push(entityNode);
    nodeById.set(id, entityNode);

    for (const observation of cluster.observations) {
      const symbol = symbolById.get(observation.functionId);
      for (const event of canonicalEvents(observation)) {
        const region = innermostRegion(symbol, Number(event.line || 0));
        const sourceId = region?.id || observation.functionId;
        const sourceType = region ? 'function-region' : 'function';
        const sourceNode = nodeById.get(sourceId);
        addLink(sourceNode, id, event.relationship);

        entityLinks.push({
          sourceId,
          sourceType,
          relationship: event.relationship,
          targetId: id,
          targetType: 'entity',
          functionId: observation.functionId,
          regionId: region?.id || '',
          sourcePath: observation.sourcePath || symbol?.sourcePath || '',
          startLine: Number(event.line || 0),
          endLine: Number(event.endLine || event.line || 0),
          variable: observation.variable || '',
          origin: event.detail || originNames(observation).join('|')
        });
      }
    }
  }

  nodes.sort((a, b) => {
    const rank = { entity: 0, workflow: 1, function: 2, 'function-region': 3 };
    const ar = rank[a.type] ?? 9;
    const br = rank[b.type] ?? 9;
    if (ar !== br) return ar - br;
    if (a.type === 'entity') return Number(b.details?.coreScore || 0) - Number(a.details?.coreScore || 0);
    return String(a.details?.name || a.id).localeCompare(String(b.details?.name || b.id));
  });

  return { nodes, entityLinks };
}
