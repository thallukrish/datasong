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

function strongIdentity(observation) {
  const annotation = norm(observation?.annotation);
  if (annotation) return `annotation:${annotation}`;
  const keys = uniq(observation?.keys).map(norm);
  if (keys.length >= 2) return `keys:${keys.join('|')}`;
  const constructors = originNames(observation)
    .filter((name) => arr(observation?.origins).some((origin) => origin?.name === name && origin?.kind === 'constructed'))
    .map(norm);
  if (constructors.length) return `origin:${constructors.join('|')}`;
  const members = uniq([...(observation?.members || []), ...(observation?.methods || [])]).map(norm);
  if (members.length >= 2) return `shape:${norm(observation?.kind)}:${members.join('|')}`;
  return '';
}

function similarity(left, right) {
  if (left.kind && right.kind && left.kind !== right.kind) return 0;
  const a = new Set(uniq([...(left.members || []), ...(left.methods || []), ...(left.keys || [])]).map(norm));
  const b = new Set(uniq([...(right.members || []), ...(right.methods || []), ...(right.keys || [])]).map(norm));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / new Set([...a, ...b]).size;
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

function clusterObservations(observations) {
  const clusters = [];
  const byStrong = new Map();
  for (const observation of arr(observations)) {
    const key = strongIdentity(observation);
    if (key && byStrong.has(key)) {
      mergeCluster(byStrong.get(key), observation);
      continue;
    }
    let cluster = null;
    const alias = norm(observation?.variable);
    cluster = clusters.find((candidate) => {
      if (candidate.kind !== observation.kind) return false;
      const score = similarity(candidate.prototype, observation);
      const aliasMatch = alias && [...candidate.aliases].some((value) => norm(value) === alias);
      if (key && candidate.strongKey && key !== candidate.strongKey) return score >= 0.75;
      return score >= 0.6 || (aliasMatch && score > 0);
    }) || null;
    if (!cluster) {
      cluster = {
        strongKey: key,
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
      if (key) byStrong.set(key, cluster);
    }
    mergeCluster(cluster, observation);
  }
  return clusters;
}

function entityId(cluster) {
  const fingerprint = [
    cluster.strongKey,
    cluster.kind,
    [...cluster.annotations].sort().join(','),
    [...cluster.origins].sort().join(','),
    [...cluster.members].sort().join(','),
    [...cluster.keys].sort().join(',')
  ].join('|');
  return `data-entity:${crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 12)}`;
}

function entityName(cluster) {
  const annotation = [...cluster.annotations][0];
  if (annotation) return annotation;
  const origin = [...cluster.origins][0];
  if (origin) return leaf(origin);
  const aliases = [...cluster.aliases].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return aliases[0] || cluster.kind || 'object';
}

function relationshipFor(observation) {
  const ops = new Set(observation?.operations || []);
  const parts = [];
  if (arr(observation?.origins).some((origin) => ['constructed', 'container', 'mapping', 'sequence', 'set'].includes(origin?.kind))) parts.push('creates');
  if (ops.has('mutate') || ops.has('write')) parts.push('modifies');
  if (ops.has('read')) parts.push('reads');
  if (ops.has('pass')) parts.push('passes');
  if (ops.has('return')) parts.push('returns');
  return parts.length ? parts.join(', ') : 'uses';
}

export function buildPythonDataStructureGraph({ symbols = [], observations = [] } = {}) {
  const clusters = clusterObservations(observations);
  const nodes = [];
  const functionNodes = new Map();
  const relevantFunctions = new Set(arr(symbols).map((symbol) => symbol?.id).filter(Boolean));

  for (const symbol of arr(symbols)) {
    const links = [];
    for (const ref of arr(symbol.references)) {
      if (ref?.relation === 'calls' && ref?.targetSymbolId && relevantFunctions.has(ref.targetSymbolId)) {
        links.push({ id: ref.targetSymbolId, relationship: 'calls' });
      }
    }
    const node = {
      id: symbol.id,
      type: 'function',
      details: {
        name: symbol.name,
        sourcePath: symbol.sourcePath,
        startLine: Number(symbol.startLine || 0),
        endLine: Number(symbol.endLine || 0)
      },
      links
    };
    functionNodes.set(symbol.id, node);
    nodes.push(node);
  }

  for (const cluster of clusters) {
    const id = entityId(cluster);
    const functionCount = cluster.functionIds.size;
    const flowCount = new Set();
    for (const symbol of arr(symbols)) {
      if (!cluster.functionIds.has(symbol.id)) continue;
      for (const ref of arr(symbol.references)) {
        if (ref?.relation === 'calls' && ref?.targetSymbolId && cluster.functionIds.has(ref.targetSymbolId)) {
          flowCount.add(`${symbol.id}->${ref.targetSymbolId}`);
        }
      }
    }

    const entityLinks = [];
    for (const observation of cluster.observations) {
      const relationship = relationshipFor(observation);
      const reverseRelationship = `used by function: ${relationship}`;
      if (!entityLinks.some((link) => link.id === observation.functionId && link.relationship === reverseRelationship)) {
        entityLinks.push({ id: observation.functionId, relationship: reverseRelationship });
      }
      const fn = functionNodes.get(observation.functionId);
      if (fn && !fn.links.some((link) => link.id === id && link.relationship === relationship)) {
        fn.links.push({ id, relationship });
      }
    }

    nodes.push({
      id,
      type: 'data-structure',
      details: {
        name: entityName(cluster),
        kind: cluster.kind,
        functionCount,
        flowEdgeCount: flowCount.size,
        coreScore: functionCount + flowCount.size,
        aliases: [...cluster.aliases].sort(),
        annotations: [...cluster.annotations].sort(),
        origins: [...cluster.origins].sort(),
        members: [...cluster.members].sort(),
        methods: [...cluster.methods].sort(),
        keys: [...cluster.keys].sort(),
        observations: cluster.observations.map((observation) => ({
          functionId: observation.functionId,
          functionName: observation.functionName,
          variable: observation.variable,
          sourcePath: observation.sourcePath,
          firstLine: observation.firstLine,
          lastLine: observation.lastLine,
          operations: observation.operations,
          passedTo: observation.passedTo,
          returned: observation.returned
        }))
      },
      links: entityLinks
    });
  }

  return nodes.sort((a, b) => {
    if (a.type === b.type && a.type === 'data-structure') return (b.details.coreScore || 0) - (a.details.coreScore || 0);
    if (a.type === b.type) return String(a.details?.name || '').localeCompare(String(b.details?.name || ''));
    return a.type === 'data-structure' ? -1 : 1;
  });
}
