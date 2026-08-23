const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 240) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const MAX_SEMANTIC_FIELDS = 5;
const MAX_ISOLATED_NEIGHBOURS = 12;
const STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','by','can','for','from','has','have','in','is','it','its','of','on','or','that','the','their','this','to','used','using','was','were','which','with',
  'field','fields','entity','record','records','value','values','identifier','identifies','identification','description','type','types','code','codes','date','time'
]);

function usageOf(usage = {}) {
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const completion = Number(usage.completion_tokens || usage.output_tokens || 0);
  return { prompt, completion, total:Number(usage.total_tokens || prompt + completion) };
}
function addUsage(total, usage) {
  total.prompt += Number(usage?.prompt || 0);
  total.completion += Number(usage?.completion || 0);
  total.total += Number(usage?.total || 0);
}
function parseJson(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
async function modelJson(client, model, system, payload) {
  const completion = await client.chat.completions.create({
    model,
    messages:[{ role:'system', content:`Return JSON only. ${system}` }, { role:'user', content:JSON.stringify(payload) }],
    response_format:{ type:'json_object' },
    thinking:{ type:'disabled' },
    temperature:0
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  return { parsed:parseJson(raw), usage:usageOf(completion.usage || {}) };
}
function naturalWords(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word) && !/^\d+$/.test(word));
}

function graphIndex(graph = []) {
  const nodes = new Map(arr(graph).filter((node) => node?.id).map((node) => [String(node.id), node]));
  const entities = new Map();
  const entityIdToName = new Map();
  for (const node of nodes.values()) {
    if (node?.type !== 'entity' || !node?.name) continue;
    const name = String(node.name);
    const entity = { name, description:text(node.data?.description, 320), fields:[] };
    entities.set(key(name), entity);
    entityIdToName.set(String(node.id), name);
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
      entity.fields.push({ name, type:text(fieldNode.data?.dataType, 60), isPk:!!fieldNode.data?.isPk, description:text(fieldNode.data?.description, 220) });
    }
  }

  const relationships = [];
  const seen = new Set();
  for (const node of nodes.values()) {
    if (node?.type !== 'entity') continue;
    for (const link of arr(node.links)) {
      if (link?.data?.relationshipKind !== 'schema_fk' || link?.data?.evidenced === false) continue;
      const from = entityIdToName.get(String(node.id));
      const to = entityIdToName.get(String(link?.nodeId || ''));
      if (!from || !to) continue;
      const keyMaps = arr(link?.data?.keyMaps).map((item) => ({
        fieldName:text(item?.fieldName, 120),
        relatedFieldName:text(item?.relatedFieldName, 120),
        implicit:!!item?.implicit
      })).filter((item) => item.fieldName || item.relatedFieldName);
      const signature = `${key(from)}|${key(to)}|${key(link.relationship)}|${keyMaps.map((m) => `${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`;
      if (seen.has(signature)) continue;
      seen.add(signature);
      relationships.push({
        from,
        to,
        relationship:text(link?.relationship || 'related to', 120),
        cardinality:text(link?.cardinality || 'unknown', 60),
        keyMaps,
        description:text(link?.data?.description, 220),
        evidenced:true
      });
    }
  }
  return { entities, relationships };
}

function semanticFieldHints(graphEntities) {
  const entities = [...graphEntities.values()];
  const docs = new Map();
  const df = new Map();
  for (const entity of entities) {
    const counts = new Map(), evidence = new Map();
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
  const n = Math.max(entities.length, 1), result = new Map();
  for (const entity of entities) {
    const doc = docs.get(key(entity.name)) || { counts:new Map(), evidence:new Map() };
    const total = [...doc.counts.values()].reduce((sum, count) => sum + count, 0) || 1;
    const scored = [];
    for (const [word, count] of doc.counts) {
      const tf = count / total;
      const idf = Math.log((n + 1) / ((df.get(word) || 0) + 1)) + 1;
      const evidence = doc.evidence.get(word) || {};
      scored.push({ term:word, score:Number((tf * idf).toFixed(4)), field:evidence.field || '', evidence:evidence.description || '' });
    }
    scored.sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));
    result.set(key(entity.name), scored.slice(0, MAX_SEMANTIC_FIELDS));
  }
  return result;
}

function pkNames(entity) {
  return new Set(arr(entity?.fields).filter((field) => field?.isPk).map((field) => key(field.name)));
}
function isSharedPkOneRelationship(index, edge) {
  if (String(edge?.cardinality || '').toLowerCase() !== 'one') return false;
  const from = index.entities.get(key(edge?.from));
  const to = index.entities.get(key(edge?.to));
  if (!from || !to || !arr(edge?.keyMaps).length) return false;
  const fromPk = pkNames(from), toPk = pkNames(to);
  if (!fromPk.size || !toPk.size) return false;
  const mappedFrom = new Set(arr(edge.keyMaps).map((map) => key(map?.fieldName)));
  const mappedTo = new Set(arr(edge.keyMaps).map((map) => key(map?.relatedFieldName || map?.fieldName)));
  return [...fromPk].every((name) => mappedFrom.has(name)) && [...toPk].every((name) => mappedTo.has(name));
}
function hasConcreteValueField(entity) {
  return arr(entity?.fields).some((field) => {
    if (field?.isPk) return false;
    const name = String(field?.name || '');
    if (!name || /id$/i.test(name)) return false;
    return !['createdDate','lastUpdatedStamp','lastUpdatedDate','createdStamp'].includes(name);
  });
}
function queryEndpointRoles(index) {
  const subtypeChildren = new Map();
  const degree = new Map();
  for (const edge of index.relationships) {
    degree.set(key(edge.from), (degree.get(key(edge.from)) || 0) + 1);
    degree.set(key(edge.to), (degree.get(key(edge.to)) || 0) + 1);
    if (!isSharedPkOneRelationship(index, edge)) continue;
    const parentKey = key(edge.to);
    if (!subtypeChildren.has(parentKey)) subtypeChildren.set(parentKey, new Set());
    subtypeChildren.get(parentKey).add(key(edge.from));
  }
  const roles = new Map();
  for (const entity of index.entities.values()) {
    const k = key(entity.name);
    const children = subtypeChildren.get(k) || new Set();
    if (children.size >= 2) {
      roles.set(k, { role:'abstract_parent', querySelectable:false, reason:`shared PK parent of ${children.size} concrete subtype entities` });
      continue;
    }
    if (!hasConcreteValueField(entity) && Number(degree.get(k) || 0) > 0) {
      roles.set(k, { role:'structural_connector', querySelectable:false, reason:'identifier-only relationship/bridge entity with no concrete value fields' });
      continue;
    }
    roles.set(k, { role:'concrete_endpoint', querySelectable:true, reason:'has concrete business value fields' });
  }
  return roles;
}

function groupsForIntent(directory) {
  return arr(directory?.groups).map((group) => ({ name:group.name, description:group.description }));
}
function directoryCandidateEntities(directory, relevantGroups, graphEntities, semanticHints, endpointRoles) {
  const wanted = new Set(arr(relevantGroups).map(key));
  const byEntity = new Map();
  const excluded = new Map();
  for (const group of arr(directory?.groups)) {
    if (!wanted.has(key(group.name))) continue;
    for (const member of arr(group.members)) {
      const graphEntity = graphEntities.get(key(member?.entity));
      if (!graphEntity) continue;
      const endpoint = endpointRoles.get(key(graphEntity.name)) || { role:'concrete_endpoint', querySelectable:true, reason:'' };
      if (!endpoint.querySelectable) {
        excluded.set(key(graphEntity.name), { name:graphEntity.name, role:endpoint.role, reason:endpoint.reason });
        continue;
      }
      let item = byEntity.get(key(graphEntity.name));
      if (!item) {
        item = {
          name:graphEntity.name,
          description:graphEntity.description,
          groups:[],
          semanticFields:arr(semanticHints.get(key(graphEntity.name))).map((hint) => ({ term:hint.term, field:hint.field, evidence:hint.evidence }))
        };
        byEntity.set(key(graphEntity.name), item);
      }
      item.groups.push(group.name);
    }
  }
  const candidates = [...byEntity.values()].map((item) => ({ ...item, groups:uniq(item.groups) })).sort((a, b) => a.name.localeCompare(b.name));
  return { candidates, excluded:[...excluded.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

function adjacency(index) {
  const map = new Map();
  const add = (from, to, edge, reversed) => {
    const k = key(from);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ from, to, edge, reversed });
  };
  for (const edge of index.relationships) {
    add(edge.from, edge.to, edge, false);
    add(edge.to, edge.from, edge, true);
  }
  return map;
}
function shortestPath(adj, from, to, maxHops = 7) {
  if (key(from) === key(to)) return { nodes:[from], edges:[] };
  const queue = [{ name:from, nodes:[from], edges:[] }];
  const visited = new Set([key(from)]);
  while (queue.length) {
    const current = queue.shift();
    if (current.edges.length >= maxHops) continue;
    for (const next of arr(adj.get(key(current.name)))) {
      const nk = key(next.to);
      if (visited.has(nk)) continue;
      const nodes = [...current.nodes, next.to];
      const edges = [...current.edges, next];
      if (nk === key(to)) return { nodes, edges };
      visited.add(nk);
      queue.push({ name:next.to, nodes, edges });
    }
  }
  return null;
}
function connectSelectedEntities(index, selectedNames) {
  const selected = uniq(selectedNames).filter((name) => index.entities.has(key(name)));
  if (!selected.length) return { selected:[], nodes:[], edges:[], disconnected:[] };
  if (selected.length === 1) return { selected, nodes:[selected[0]], edges:[], disconnected:[] };
  const adj = adjacency(index);
  const connectedNames = new Map([[key(selected[0]), selected[0]]]);
  const remaining = new Map(selected.slice(1).map((name) => [key(name), name]));
  const unionNodes = new Map([[key(selected[0]), selected[0]]]);
  const unionEdges = new Map();
  const disconnected = [];

  while (remaining.size) {
    let best = null;
    for (const source of connectedNames.values()) {
      for (const target of remaining.values()) {
        const path = shortestPath(adj, source, target);
        if (!path) continue;
        if (!best || path.edges.length < best.path.edges.length) best = { source, target, path };
      }
    }
    if (!best) {
      disconnected.push(...remaining.values());
      break;
    }
    for (const name of best.path.nodes) unionNodes.set(key(name), name);
    for (const step of best.path.edges) {
      const edge = step.edge;
      const signature = `${key(edge.from)}|${key(edge.to)}|${key(edge.relationship)}|${edge.keyMaps.map((m) => `${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`;
      unionEdges.set(signature, edge);
    }
    connectedNames.set(key(best.target), best.target);
    remaining.delete(key(best.target));
  }
  return { selected, nodes:[...unionNodes.values()], edges:[...unionEdges.values()], disconnected };
}

function compactEntity(index, semanticHints, name, includeAllFields = false) {
  const entity = index.entities.get(key(name));
  if (!entity) return null;
  return {
    name:entity.name,
    description:entity.description,
    semanticFields:arr(semanticHints.get(key(entity.name))).map((hint) => ({ term:hint.term, field:hint.field, evidence:hint.evidence })),
    ...(includeAllFields ? { fields:entity.fields.slice(0, 24) } : {})
  };
}
function isolatedNeighbourhood(index, semanticHints, disconnectedNames) {
  const adj = adjacency(index);
  return arr(disconnectedNames).map((name) => {
    const selectedEntity = compactEntity(index, semanticHints, name, false);
    const neighbours = arr(adj.get(key(name))).slice(0, MAX_ISOLATED_NEIGHBOURS).map((step) => ({
      entity:compactEntity(index, semanticHints, step.to, false),
      link:{
        from:step.edge.from,
        to:step.edge.to,
        relationship:step.edge.relationship,
        cardinality:step.edge.cardinality,
        keyMaps:step.edge.keyMaps,
        description:step.edge.description,
        evidenced:true
      }
    })).filter((item) => item.entity);
    return { selectedEntity, neighbours };
  }).filter((item) => item.selectedEntity);
}
function groundedSlice(index, semanticHints, connection) {
  return {
    selectedEntities:connection.selected,
    disconnectedSelectedEntities:connection.disconnected,
    entities:connection.nodes.map((name) => {
      const entity = index.entities.get(key(name));
      return { name:entity.name, description:entity.description, fields:entity.fields.slice(0, 24) };
    }),
    joins:connection.edges.map((edge) => ({
      from:edge.from,
      to:edge.to,
      relationship:edge.relationship,
      cardinality:edge.cardinality,
      keyMaps:edge.keyMaps,
      description:edge.description,
      evidenced:true
    })),
    isolatedEntityNeighbourhoods:isolatedNeighbourhood(index, semanticHints, connection.disconnected)
  };
}

export async function runTwoPassQuery({ question, client, model, graph, directory, log = () => {} }) {
  const usage = { prompt:0, completion:0, total:0 };
  const index = graphIndex(graph);
  const semanticHints = semanticFieldHints(index.entities);
  const endpointRoles = queryEndpointRoles(index);
  const groups = groupsForIntent(directory);
  console.log(`[lemap query-v2] pass 1 intent: ${groups.length} groups`);
  const pass1 = await modelJson(client, model,
    'Parse the user question into stable canonical business requirements and select every business directory group that is plausibly needed to satisfy those requirements. Select groups whose entities can directly represent the requested business data; do not select a group merely because it owns, classifies, or is generally associated with that data. Do not choose database fields or entities. Coverage matters more than minimizing groups. Return {"intent":"short business intent","requirements":[{"concept":"canonical business concept","role":"measure|dimension|time|filter|attribute|key|derived","value":"optional"}],"relevantGroups":["exact supplied group names"],"interpretation":"one sentence"}.',
    { question, groups });
  addUsage(usage, pass1.usage);
  const validGroups = new Map(groups.map((group) => [key(group.name), group.name]));
  const relevantGroups = uniq(arr(pass1.parsed?.relevantGroups).map((name) => validGroups.get(key(name))).filter(Boolean));
  const requirements = arr(pass1.parsed?.requirements).slice(0, 12).map((item) => ({ concept:text(item?.concept, 100), role:text(item?.role, 30), value:text(item?.value, 120) })).filter((item) => item.concept);
  const intent = { intent:text(pass1.parsed?.intent, 160), interpretation:text(pass1.parsed?.interpretation, 260), requirements, relevantGroups };
  console.log(`[lemap query-v2] pass 1 groups: ${relevantGroups.join(', ') || '(none)'}; requirements: ${requirements.map((r) => r.concept).join(', ') || '(none)'}; tokens ${pass1.usage.total}`);
  log('query_v2_intent', { question, intent, usage:pass1.usage });

  const candidateSet = directoryCandidateEntities(directory, relevantGroups, index.entities, semanticHints, endpointRoles);
  const candidates = candidateSet.candidates;
  const excluded = candidateSet.excluded;
  const abstractCount = excluded.filter((item) => item.role === 'abstract_parent').length;
  const connectorCount = excluded.filter((item) => item.role === 'structural_connector').length;
  console.log(`[lemap query-v2] endpoint filter: ${excluded.length} hidden from model (${abstractCount} abstract parents, ${connectorCount} structural connectors); traversal remains unrestricted`);
  console.log(`[lemap query-v2] pass 2 entity selection: ${candidates.length} concrete endpoint candidates from selected groups`);
  const pass2 = await modelJson(client, model,
    'Select the smallest sufficient set of concrete physical endpoint entities that directly satisfy ALL canonical requirements. Parent/base entities and identifier-only structural connectors have already been removed; LeMap may traverse them later, so do not compensate for their absence. Choose an entity only when its OWN description or compact semantic field evidence directly represents the requirement. Do not choose an entity merely because it may own, classify, contain, or be related to the desired data. Do not choose joins and do not invent fields. Return {"selectedEntities":[{"entity":"exact candidate entity name","covers":["requirement concepts"],"reason":"short evidence-based semantic reason"}],"uncoveredRequirements":["concepts not directly represented by any candidate"]}.',
    { question, logicalRequest:intent, candidates });
  addUsage(usage, pass2.usage);
  const candidateNames = new Map(candidates.map((item) => [key(item.name), item.name]));
  const selectedEntities = uniq(arr(pass2.parsed?.selectedEntities).map((item) => candidateNames.get(key(item?.entity))).filter(Boolean)).slice(0, 8);
  const selections = arr(pass2.parsed?.selectedEntities).map((item) => ({ entity:candidateNames.get(key(item?.entity)) || '', covers:arr(item?.covers).map(String), reason:text(item?.reason, 220) })).filter((item) => item.entity);
  console.log(`[lemap query-v2] pass 2 selected: ${selectedEntities.join(', ') || '(none)'}; tokens ${pass2.usage.total}`);
  log('query_v2_entities', { selectedEntities:selections, uncoveredRequirements:arr(pass2.parsed?.uncoveredRequirements), candidateCount:candidates.length, excludedCandidateCount:excluded.length, excludedCandidates:excluded, usage:pass2.usage });

  const connection = connectSelectedEntities(index, selectedEntities);
  const slice = groundedSlice(index, semanticHints, connection);
  const isolatedNeighbourCount = slice.isolatedEntityNeighbourhoods.reduce((sum, item) => sum + item.neighbours.length, 0);
  console.log(`[lemap query-v2] local graph: ${slice.entities.length} connected entities, ${slice.joins.length} evidenced joins${connection.disconnected.length ? `; isolated selected: ${connection.disconnected.join(', ')} with ${isolatedNeighbourCount} one-hop neighbours` : ''}`);
  log('query_v2_local_graph', { selectedEntities, connectedEntities:slice.entities.map((e) => e.name), joins:slice.joins, disconnected:connection.disconnected, isolatedEntityNeighbourhoods:slice.isolatedEntityNeighbourhoods });

  const finalCall = await modelJson(client, model,
    'Answer the business question using ONLY the supplied grounded graph evidence. Map canonical requirements to observed entity fields, use only supplied evidenced joins, and never invent a field or join. Connected graph entities include full observed field lists. Structural/base/bridge entities may legitimately appear inside the local graph even though they were hidden from semantic endpoint selection; treat them as connectivity unless their supplied fields directly answer a requirement. If a selected entity could not be connected, its isolated one-hop neighbourhood contains compact semantic field evidence plus exact evidenced links; use that to explain what the isolated area contains, but do NOT claim a join from it to the connected graph unless such a join is supplied. If evidence is insufficient, say exactly what is missing. Return {"answer":"concise answer about the available data/view","dataView":{"grain":"result level","select":[{"entity":"","field":"","role":"measure|dimension|time|filter|attribute|key|derived"}],"joins":[{"left":"Entity.field","right":"Entity.field","relation":"","evidenced":true}],"groupBy":["Entity.field"],"orderBy":[{"field":"Entity.field or derived expression","direction":"asc|desc"}],"filters":[],"derived":[{"name":"","expression":"business-level expression using observed fields"}],"missing":[]},"nextStep":"optional"}.',
    { question, logicalRequest:intent, entitySelections:selections, groundedGraph:slice });
  addUsage(usage, finalCall.usage);
  console.log(`[lemap query-v2] final answer tokens ${finalCall.usage.total}; total ${usage.total}`);
  log('query_v2_answer', { response:finalCall.parsed, usage:finalCall.usage, cumulativeUsage:usage });

  return {
    ...finalCall.parsed,
    investigation:{
      mode:'two-pass-concrete-endpoints-local-shortest-path-with-isolated-neighbourhoods',
      logicalRequest:intent,
      relevantGroups,
      candidateEntityCount:candidates.length,
      excludedCandidateCount:excluded.length,
      excludedCandidates:excluded,
      selectedEntities:selections,
      localGraph:{
        entityCount:slice.entities.length,
        joinCount:slice.joins.length,
        entities:slice.entities.map((entity) => entity.name),
        joins:slice.joins,
        disconnectedSelectedEntities:connection.disconnected,
        isolatedEntityNeighbourhoods:slice.isolatedEntityNeighbourhoods
      },
      usage
    }
  };
}
