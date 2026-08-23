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

function clusterStrength({ pairCount, leftCoverage, rightCoverage }) {
  const minCoverage = Math.min(leftCoverage, rightCoverage);
  if (pairCount >= 5 || (pairCount >= 3 && minCoverage >= 0.05)) return 'close';
  if (pairCount >= 2) return 'related';
  return 'light';
}

function directoryWithClusterGraph(directory, graph) {
  const groups = arr(directory?.groups);
  if (!groups.length) return directory;

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
    const related = arr(relatedByGroup.get(key(group.name)))
      .sort((a, b) => b.score - a.score || b.pairCount - a.pairCount || a.group.localeCompare(b.group))
      .slice(0, MAX_RELATED_GROUPS)
      .map(({ score, ...item }) => item);
    if (!related.length) return { ...group };
    const relationSummary = related.map((item) => {
      const via = item.bridges.length ? ` via ${item.bridges.join(', ')}` : '';
      return `${item.group} (${item.strength}, ${item.pairCount} evidenced entity links${via})`;
    }).join('; ');
    return {
      ...group,
      description:`${String(group.description || '').trim()} Related business areas: ${relationSummary}.`.trim(),
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

      console.log(`\n[lemap query-v2] ${question}`);
      console.log(`[lemap query-v2] graph ${entityCount} entities; directory ${directory.groups.length} groups; ${Math.round(clusterLinkCount)} derived cluster links; no iterative walker`);
      append(queryLog, 'query_v2_start', {
        question,
        repoUrl:snapshot.repoUrl || '',
        commit:snapshot.commit || '',
        graphEntityCount:entityCount,
        directoryFile:file,
        directoryGroupCount:directory.groups.length,
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
