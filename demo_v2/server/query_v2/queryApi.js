import fs from 'node:fs';
import path from 'node:path';
import { graphFromSemanticObjects } from '../explorer/mapPersistence.js';
import { loadEntityDirectory } from '../entityDirectory.js';
import { runTwoPassQuery } from './queryEngine.js';

const arr = (value) => Array.isArray(value) ? value : [];
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const text = (value, max = 180) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const MAX_RELATED_GROUPS = 6;
const MAX_BRIDGES_PER_GROUP_PAIR = 4;
const MAX_CONCRETE_REPRESENTATIVES = 5;
const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','can','for','from','has','have','in','is','it','its','of','on','or','that','the','their','this','to','used','using','was','were','which','with',
  'field','fields','entity','record','records','value','values','identifier','identifies','identification','description','type','types','code','codes','date','time'
]);

function naturalWords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

function clusterStrength({ pairCount, leftCoverage, rightCoverage }) {
  const minCoverage = Math.min(leftCoverage, rightCoverage);
  if (pairCount >= 5 || (pairCount >= 3 && minCoverage >= 0.05)) return 'close';
  if (pairCount >= 2) return 'related';
  return 'light';
}

function semanticEntityIndex(graph) {
  const nodes = new Map(arr(graph).filter((node) => node?.id).map((node) => [String(node.id), node]));
  const entities = new Map();
  const entityNameById = new Map();

  for (const node of nodes.values()) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const name = String(node.name);
    entities.set(key(name), { name, description:text(node.data?.description, 320), fields:[], pk:new Set() });
    entityNameById.set(String(node.id), name);
  }

  for (const node of nodes.values()) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const entity = entities.get(key(node.name));
    for (const link of arr(node.links)) {
      if (String(link?.relationship || '') !== 'has field') continue;
      const fieldNode = nodes.get(String(link?.nodeId || ''));
      if (fieldNode?.type !== 'field') continue;
      const fieldName = text(fieldNode.data?.physicalFieldName || fieldNode.data?.fieldName || String(fieldNode.name || '').split('.').at(-1), 120);
      if (!fieldName || entity.fields.some((field) => key(field.name) === key(fieldName))) continue;
      const field = {
        name:fieldName,
        isPk:!!fieldNode.data?.isPk,
        description:text(fieldNode.data?.description, 220)
      };
      entity.fields.push(field);
      if (field.isPk) entity.pk.add(key(field.name));
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

  const abstractParents = new Map();
  for (const [parentKey, children] of childrenByParent) {
    if (children.size < 2) continue;
    const parent = entities.get(parentKey);
    abstractParents.set(parentKey, {
      name:parent?.name || '',
      description:parent?.description || '',
      concreteInstances:[...children.values()].sort()
    });
  }

  const docs = new Map(), df = new Map();
  for (const entity of entities.values()) {
    const counts = new Map();
    for (const field of entity.fields) {
      for (const word of naturalWords(field.description)) counts.set(word, (counts.get(word) || 0) + 1);
    }
    docs.set(key(entity.name), counts);
    for (const word of counts.keys()) df.set(word, (df.get(word) || 0) + 1);
  }
  const n = Math.max(entities.size, 1);
  for (const entity of entities.values()) {
    const counts = docs.get(key(entity.name)) || new Map();
    const total = [...counts.values()].reduce((sum, count) => sum + count, 0) || 1;
    let tfidfScore = 0;
    for (const [word, count] of counts) {
      const tf = count / total;
      const idf = Math.log((n + 1) / ((df.get(word) || 0) + 1)) + 1;
      tfidfScore += tf * idf;
    }
    entity.tfidfScore = Number(tfidfScore.toFixed(6));
    entity.hasConcreteValueField = entity.fields.some((field) => {
      if (field.isPk) return false;
      if (!field.name || /id$/i.test(field.name)) return false;
      return !['createdDate','lastUpdatedStamp','lastUpdatedDate','createdStamp'].includes(field.name);
    });
  }

  return { entities, entityNameById, abstractParents };
}

function directoryWithClusterGraph(directory, graph) {
  const groups = arr(directory?.groups);
  if (!groups.length) return directory;

  const semantic = semanticEntityIndex(graph);
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

  const pairStats = new Map();
  const seenEdges = new Set();
  for (const node of arr(graph)) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const fromName = String(node.name);
    const fromGroups = groupsByEntity.get(key(fromName));
    if (!fromGroups?.size) continue;

    for (const link of arr(node.links)) {
      if (link?.data?.relationshipKind !== 'schema_fk' || link?.data?.evidenced === false) continue;
      const toName = semantic.entityNameById.get(String(link?.nodeId || ''));
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
            stat.bridges.set(bridgeKey, { from:fromName, to:toName, relationship:text(link?.relationship || 'related to') });
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
    const leftCoverage = (stat.entitiesByGroup.get(leftKey)?.size || 0) / (groupSizes.get(leftKey) || 1);
    const rightCoverage = (stat.entitiesByGroup.get(rightKey)?.size || 0) / (groupSizes.get(rightKey) || 1);
    const strength = clusterStrength({ pairCount, leftCoverage, rightCoverage });
    const score = pairCount + (leftCoverage + rightCoverage) * 4;
    const compactBridges = bridges.slice(0, MAX_BRIDGES_PER_GROUP_PAIR).map((bridge) => `${bridge.from}↔${bridge.to}`);
    relatedByGroup.get(leftKey)?.push({ group:rightGroup.name, strength, score, pairCount, bridges:compactBridges });
    relatedByGroup.get(rightKey)?.push({ group:leftGroup.name, strength, score, pairCount, bridges:compactBridges });
  }

  const enrichedGroups = groups.map((group) => {
    const memberEntities = arr(group.members)
      .map((member) => semantic.entities.get(key(member?.entity)))
      .filter(Boolean);

    const abstractEntities = memberEntities
      .map((entity) => semantic.abstractParents.get(key(entity.name)))
      .filter(Boolean)
      .filter((entity, index, list) => list.findIndex((item) => key(item.name) === key(entity.name)) === index)
      .map((entity) => ({ name:entity.name, description:entity.description, concreteInstances:entity.concreteInstances }));

    const representativeConcreteEntities = memberEntities
      .filter((entity) => !semantic.abstractParents.has(key(entity.name)) && entity.hasConcreteValueField)
      .sort((a, b) => b.tfidfScore - a.tfidfScore || a.name.localeCompare(b.name))
      .slice(0, MAX_CONCRETE_REPRESENTATIVES)
      .map((entity) => ({ name:entity.name, description:entity.description, tfidfScore:entity.tfidfScore }));

    const related = arr(relatedByGroup.get(key(group.name)))
      .sort((a, b) => b.score - a.score || b.pairCount - a.pairCount || a.group.localeCompare(b.group))
      .slice(0, MAX_RELATED_GROUPS)
      .map(({ score, ...item }) => item);

    const abstractSummary = abstractEntities.length
      ? `Abstract/base entities (always shown): ${abstractEntities.map((item) => `${item.name}${item.concreteInstances.length ? ` [parent of ${item.concreteInstances.join(', ')}]` : ''}${item.description ? ` — ${item.description}` : ''}`).join('; ')}.`
      : 'Abstract/base entities: none detected in this cluster.';
    const concreteSummary = representativeConcreteEntities.length
      ? `Representative concrete entities (top ${MAX_CONCRETE_REPRESENTATIVES} by TF-IDF semantic evidence): ${representativeConcreteEntities.map((item) => `${item.name}${item.description ? ` — ${item.description}` : ''}`).join('; ')}.`
      : 'Representative concrete entities: none with concrete value fields.';
    const relationSummary = related.length
      ? `Related business areas: ${related.map((item) => `${item.group} (${item.strength}, ${item.pairCount} evidenced entity links${item.bridges.length ? ` via ${item.bridges.join(', ')}` : ''})`).join('; ')}.`
      : '';

    return {
      ...group,
      baseDescription:String(group.description || '').trim(),
      abstractEntities,
      representativeConcreteEntities,
      relatedGroups:related,
      description:[String(group.description || '').trim(), abstractSummary, concreteSummary, relationSummary].filter(Boolean).join(' ')
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
      const abstractEntityMentions = queryDirectory.groups.reduce((sum, group) => sum + arr(group.abstractEntities).length, 0);

      console.log(`\n[lemap query-v2] ${question}`);
      console.log(`[lemap query-v2] graph ${entityCount} entities; directory ${directory.groups.length} groups; ${Math.round(clusterLinkCount)} derived cluster links; ${abstractEntityMentions} abstract entity mentions; no iterative walker`);
      append(queryLog, 'query_v2_start', {
        question,
        repoUrl:snapshot.repoUrl || '',
        commit:snapshot.commit || '',
        graphEntityCount:entityCount,
        directoryFile:file,
        directoryGroupCount:directory.groups.length,
        derivedClusterLinkCount:Math.round(clusterLinkCount),
        abstractEntityMentions
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
