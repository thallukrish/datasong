import fs from 'node:fs';
import path from 'node:path';
import { graphFromSemanticObjects } from '../explorer/mapPersistence.js';
import { loadEntityDirectory } from '../entityDirectory.js';
import { runTwoPassQuery } from './queryEngine.js';

const arr = (value) => Array.isArray(value) ? value : [];
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const text = (value, max = 120) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const MAX_RELATED_GROUPS = 6;
const MAX_BRIDGES_PER_GROUP_PAIR = 4;
const CLUSTER_SUFFIX_WORDS = new Set(['management','billing','processing','tracking','administration','operations']);

function clusterStrength({ pairCount, leftCoverage, rightCoverage }) {
  const minCoverage = Math.min(leftCoverage, rightCoverage);
  if (pairCount >= 5 || (pairCount >= 3 && minCoverage >= 0.05)) return 'close';
  if (pairCount >= 2) return 'related';
  return 'light';
}

function abstractParentIndex(graph) {
  const nodes = new Map(arr(graph).filter((node) => node?.id).map((node) => [String(node.id), node]));
  const entities = new Map();
  const entityNameById = new Map();
  for (const node of nodes.values()) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const name = String(node.name);
    entities.set(key(name), { name, pk:new Set() });
    entityNameById.set(String(node.id), name);
  }
  for (const node of nodes.values()) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const entity = entities.get(key(node.name));
    for (const link of arr(node.links)) {
      if (String(link?.relationship || '') !== 'has field') continue;
      const fieldNode = nodes.get(String(link?.nodeId || ''));
      if (fieldNode?.type !== 'field' || !fieldNode.data?.isPk) continue;
      const fieldName = text(fieldNode.data?.physicalFieldName || fieldNode.data?.fieldName || String(fieldNode.name || '').split('.').at(-1), 120);
      if (fieldName) entity.pk.add(key(fieldName));
    }
  }

  const childrenByParent = new Map();
  for (const node of nodes.values()) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const fromName = String(node.name);
    const fromEntity = entities.get(key(fromName));
    if (!fromEntity?.pk.size) continue;
    for (const link of arr(node.links)) {
      if (link?.data?.relationshipKind !== 'schema_fk' || link?.data?.evidenced === false) continue;
      if (String(link?.cardinality || '').toLowerCase() !== 'one') continue;
      const toName = entityNameById.get(String(link?.nodeId || ''));
      const toEntity = entities.get(key(toName));
      if (!toEntity?.pk.size) continue;
      const keyMaps = arr(link?.data?.keyMaps);
      if (!keyMaps.length) continue;
      const mappedFrom = new Set(keyMaps.map((map) => key(map?.fieldName)));
      const mappedTo = new Set(keyMaps.map((map) => key(map?.relatedFieldName || map?.fieldName)));
      const sharesWholePk = [...fromEntity.pk].every((name) => mappedFrom.has(name)) && [...toEntity.pk].every((name) => mappedTo.has(name));
      if (!sharesWholePk) continue;
      const parentKey = key(toName);
      if (!childrenByParent.has(parentKey)) childrenByParent.set(parentKey, new Map());
      childrenByParent.get(parentKey).set(key(fromName), fromName);
    }
  }

  const result = new Map();
  for (const [parentKey, children] of childrenByParent) {
    if (children.size < 2) continue;
    result.set(parentKey, {
      name:entities.get(parentKey)?.name || '',
      concreteInstances:[...children.values()].sort()
    });
  }
  return result;
}

function clusterCoreKey(groupName) {
  const words = String(groupName || '').trim().split(/\s+/).filter(Boolean);
  while (words.length > 1 && CLUSTER_SUFFIX_WORDS.has(words.at(-1).toLowerCase())) words.pop();
  return key(words.join(' '));
}

function clusterRole(group, abstractParents) {
  const coreKey = clusterCoreKey(group?.name);
  const parent = abstractParents.get(coreKey);
  const hasParentMember = !!parent && arr(group?.members).some((member) => key(member?.entity) === coreKey);
  if (hasParentMember) {
    return {
      role:'umbrella',
      abstractParent:parent.name,
      concreteConcepts:parent.concreteInstances,
      reason:`cluster is organized around abstract parent ${parent.name}`
    };
  }
  return { role:'business_area', abstractParent:'', concreteConcepts:[], reason:'cluster is not centered on an abstract parent' };
}

function directoryWithClusterGraph(directory, graph) {
  const groups = arr(directory?.groups);
  if (!groups.length) return directory;

  const abstractParents = abstractParentIndex(graph);
  const groupByKey = new Map(groups.map((group) => [key(group.name), group]));
  const groupSizes = new Map(groups.map((group) => [key(group.name), Math.max(arr(group.members).length, 1)]));
  const groupsByEntity = new Map();
  for (const group of groups) {
    for (const member of arr(group.members)) {
      const entityKey = key(member?.entity);
      if (!entityKey) continue;
      if (!groupsByEntity.has(entityKey)) groupsByEntity.set(entityKey, new Set());
      groupsByEntity.get(entityKey).add(key(group.name));
    }
  }

  const entityNameById = new Map();
  for (const node of arr(graph)) {
    if (node?.type === 'entity' && node?.id && node?.name) entityNameById.set(String(node.id), String(node.name));
  }

  const pairStats = new Map();
  const seenEdges = new Set();
  for (const node of arr(graph)) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const fromName = String(node.name);
    const fromGroups = groupsByEntity.get(key(fromName));
    if (!fromGroups?.size) continue;

    for (const link of arr(node.links)) {
      if (link?.data?.relationshipKind !== 'schema_fk' || link?.data?.evidenced === false) continue;
      const toName = entityNameById.get(String(link?.nodeId || ''));
      if (!toName) continue;
      const toGroups = groupsByEntity.get(key(toName));
      if (!toGroups?.size) continue;

      const edgeSig = [key(fromName), key(toName)].sort().join('|') + `|${key(link?.relationship)}`;
      if (seenEdges.has(edgeSig)) continue;
      seenEdges.add(edgeSig);

      for (const fromGroupKey of fromGroups) {
        for (const toGroupKey of toGroups) {
          if (fromGroupKey === toGroupKey) continue;
          const ordered = [fromGroupKey, toGroupKey].sort();
          const pairKey = ordered.join('|');
          let stat = pairStats.get(pairKey);
          if (!stat) {
            stat = {
              groups:ordered,
              bridges:new Map(),
              entitiesByGroup:new Map([[ordered[0], new Set()], [ordered[1], new Set()]])
            };
            pairStats.set(pairKey, stat);
          }
          const bridgeKey = [key(fromName), key(toName)].sort().join('|');
          if (!stat.bridges.has(bridgeKey)) {
            stat.bridges.set(bridgeKey, {
              from:fromName,
              to:toName,
              relationship:text(link?.relationship || 'related to')
            });
          }
          stat.entitiesByGroup.get(fromGroupKey)?.add(fromName);
          stat.entitiesByGroup.get(toGroupKey)?.add(toName);
        }
      }
    }
  }

  const relatedByGroup = new Map(groups.map((group) => [key(group.name), []]));
  for (const stat of pairStats.values()) {
    const [leftKey, rightKey] = stat.groups;
    const leftGroup = groupByKey.get(leftKey), rightGroup = groupByKey.get(rightKey);
    if (!leftGroup || !rightGroup) continue;
    const bridges = [...stat.bridges.values()];
    const pairCount = bridges.length;
    const leftEntityCount = stat.entitiesByGroup.get(leftKey)?.size || 0;
    const rightEntityCount = stat.entitiesByGroup.get(rightKey)?.size || 0;
    const leftCoverage = leftEntityCount / (groupSizes.get(leftKey) || 1);
    const rightCoverage = rightEntityCount / (groupSizes.get(rightKey) || 1);
    const strength = clusterStrength({ pairCount, leftCoverage, rightCoverage });
    const score = pairCount + (leftCoverage + rightCoverage) * 4;
    const compactBridges = bridges.slice(0, MAX_BRIDGES_PER_GROUP_PAIR).map((bridge) => `${bridge.from}↔${bridge.to}`);

    relatedByGroup.get(leftKey)?.push({ group:rightGroup.name, strength, score, pairCount, bridges:compactBridges });
    relatedByGroup.get(rightKey)?.push({ group:leftGroup.name, strength, score, pairCount, bridges:compactBridges });
  }

  const enrichedGroups = groups.map((group) => {
    const role = clusterRole(group, abstractParents);
    const related = arr(relatedByGroup.get(key(group.name)))
      .sort((a, b) => b.score - a.score || b.pairCount - a.pairCount || a.group.localeCompare(b.group))
      .slice(0, MAX_RELATED_GROUPS)
      .map(({ score, ...item }) => item);
    const roleSummary = role.role === 'umbrella'
      ? `Cluster role: umbrella over abstract parent ${role.abstractParent}; concrete concepts include ${role.concreteConcepts.join(', ')}.`
      : 'Cluster role: concrete business area.';
    const relationSummary = related.map((item) => {
      const via = item.bridges.length ? ` via ${item.bridges.join(', ')}` : '';
      return `${item.group} (${item.strength}, ${item.pairCount} evidenced entity links${via})`;
    }).join('; ');
    return {
      ...group,
      clusterRole:role.role,
      abstractParent:role.abstractParent,
      concreteConcepts:role.concreteConcepts,
      description:`${String(group.description || '').trim()} ${roleSummary}${relationSummary ? ` Related business areas: ${relationSummary}.` : ''}`.trim(),
      relatedGroups:related
    };
  });

  return { ...directory, groups:enrichedGroups, clusterGraphDerived:true };
}

export function registerQueryV2Api({ app, explorer, queryClient, queryModel, dataRoot, onLatestLog = () => {} }) {
  const queryRunPath = () => {
    const dir = path.join(dataRoot, 'query-runs-v2');
    fs.mkdirSync(dir, { recursive:true });
    return path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  };
  const append = (file, type, payload = {}) => fs.appendFileSync(file, `${JSON.stringify({ type, timestamp:new Date().toISOString(), ...payload })}\n`, 'utf8');

  app.post('/api/query-map-v2', async (req, res) => {
    const queryLog = queryRunPath();
    onLatestLog(queryLog);
    try {
      if (!queryClient) return res.status(503).json({ error:'The reasoning service is not configured' });
      const question = String(req.body?.question || '').trim();
      if (!question) return res.status(400).json({ error:'question is required' });
      const snapshot = explorer.snapshot();
      const graph = graphFromSemanticObjects(snapshot.semanticObjects || {});
      const entityCount = graph.filter((node) => node?.type === 'entity').length;
      if (!entityCount) return res.status(409).json({ error:'The semantic graph has no entities yet' });
      const { directory, file } = loadEntityDirectory({ dataRoot, repoUrl:snapshot.repoUrl || '' });
      if (!directory?.groups?.length) return res.status(409).json({ error:'The entity directory is not ready yet. Run/finish LeMap learning or directory maintenance first.' });
      const queryDirectory = directoryWithClusterGraph(directory, graph);
      const clusterLinkCount = queryDirectory.groups.reduce((sum, group) => sum + arr(group.relatedGroups).length, 0) / 2;
      const umbrellaCount = queryDirectory.groups.filter((group) => group.clusterRole === 'umbrella').length;

      console.log(`\n[lemap query-v2] ${question}`);
      console.log(`[lemap query-v2] graph ${entityCount} entities; directory ${directory.groups.length} groups (${umbrellaCount} umbrella); ${Math.round(clusterLinkCount)} derived cluster links; no iterative walker`);
      append(queryLog, 'query_v2_start', {
        question,
        repoUrl:snapshot.repoUrl || '',
        commit:snapshot.commit || '',
        graphEntityCount:entityCount,
        directoryFile:file,
        directoryGroupCount:directory.groups.length,
        umbrellaClusterCount:umbrellaCount,
        derivedClusterLinkCount:Math.round(clusterLinkCount)
      });

      const response = await runTwoPassQuery({
        question,
        client:queryClient,
        model:queryModel,
        graph,
        directory:queryDirectory,
        log:(type, payload) => append(queryLog, type, payload)
      });
      append(queryLog, 'query_v2_complete', { question, response, cumulativeUsage:response?.investigation?.usage || {} });
      return res.json(response);
    } catch (error) {
      append(queryLog, 'query_v2_error', { error:error.message || String(error) });
      console.error(`[lemap query-v2] ${error.message || error}`);
      return res.status(500).json({ error:error.message || 'Query v2 failed' });
    }
  });
}
