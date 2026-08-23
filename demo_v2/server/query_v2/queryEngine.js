const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 240) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const MAX_SEMANTIC_FIELDS = 5;
const MAX_ISOLATED_NEIGHBOURS = 12;
const MAX_PATH_HOPS = 7;
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
    entities.set(key(name), { name, description:text(node.data?.description, 320), fields:[] });
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
  const docs = new Map(), df = new Map();
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
      const ev = doc.evidence.get(word) || {};
      scored.push({ term:word, score:Number((tf * idf).toFixed(4)), field:ev.field || '', evidence:ev.description || '' });
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
  const from = index.entities.get(key(edge?.from)), to = index.entities.get(key(edge?.to));
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
  const subtypeChildren = new Map(), degree = new Map();
  for (const edge of index.relationships) {
    degree.set(key(edge.from), (degree.get(key(edge.from)) || 0) + 1);
    degree.set(key(edge.to), (degree.get(key(edge.to)) || 0) + 1);
    if (!isSharedPkOneRelationship(index, edge)) continue;
    const parentKey = key(edge.to);
    if (!subtypeChildren.has(parentKey)) subtypeChildren.set(parentKey, new Map());
    subtypeChildren.get(parentKey).set(key(edge.from), edge.from);
  }
  const roles = new Map();
  for (const entity of index.entities.values()) {
    const k = key(entity.name);
    const children = subtypeChildren.get(k) || new Map();
    if (children.size >= 2) {
      roles.set(k, {
        role:'abstract_parent',
        querySelectable:false,
        concreteInstances:[...children.values()].sort(),
        reason:`shared PK parent of ${children.size} concrete subtype entities`
      });
      continue;
    }
    if (!hasConcreteValueField(entity) && Number(degree.get(k) || 0) > 0) {
      roles.set(k, {
        role:'association_entity',
        querySelectable:true,
        concreteInstances:[],
        reason:'identifier-centric relationship/association entity; may carry business meaning through the association itself'
      });
      continue;
    }
    roles.set(k, { role:'concrete_entity', querySelectable:true, concreteInstances:[], reason:'has concrete business value fields' });
  }
  return roles;
}

function groupsForIntent(directory) {
  return arr(directory?.groups).map((group) => ({ name:group.name, description:group.description }));
}
function directoryCandidateEntities(directory, relevantGroups, graphEntities, semanticHints, endpointRoles) {
  const wanted = new Set(arr(relevantGroups).map(key));
  const byEntity = new Map(), excluded = new Map();
  for (const group of arr(directory?.groups)) {
    if (!wanted.has(key(group.name))) continue;
    for (const member of arr(group.members)) {
      const graphEntity = graphEntities.get(key(member?.entity));
      if (!graphEntity) continue;
      const endpoint = endpointRoles.get(key(graphEntity.name)) || { role:'concrete_entity', querySelectable:true, concreteInstances:[], reason:'' };
      if (!endpoint.querySelectable) {
        excluded.set(key(graphEntity.name), { name:graphEntity.name, role:endpoint.role, concreteInstances:endpoint.concreteInstances, reason:endpoint.reason });
        continue;
      }
      let item = byEntity.get(key(graphEntity.name));
      if (!item) {
        item = {
          name:graphEntity.name,
          description:graphEntity.description,
          semanticRole:endpoint.role,
          groups:[],
          semanticFields:arr(semanticHints.get(key(graphEntity.name))).map((hint) => ({ term:hint.term, field:hint.field, evidence:hint.evidence }))
        };
        byEntity.set(key(graphEntity.name), item);
      }
      item.groups.push(group.name);
    }
  }
  return {
    candidates:[...byEntity.values()].map((item) => ({ ...item, groups:uniq(item.groups) })).sort((a, b) => a.name.localeCompare(b.name)),
    excluded:[...excluded.values()].sort((a, b) => a.name.localeCompare(b.name))
  };
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
function shortestPath(adj, from, to, maxHops = MAX_PATH_HOPS) {
  if (key(from) === key(to)) return { nodes:[from], edges:[] };
  const queue = [{ name:from, nodes:[from], edges:[] }];
  const visited = new Set([key(from)]);
  while (queue.length) {
    const current = queue.shift();
    if (current.edges.length >= maxHops) continue;
    for (const next of arr(adj.get(key(current.name)))) {
      const nk = key(next.to);
      if (visited.has(nk)) continue;
      const nodes = [...current.nodes, next.to], edges = [...current.edges, next];
      if (nk === key(to)) return { nodes, edges };
      visited.add(nk);
      queue.push({ name:next.to, nodes, edges });
    }
  }
  return null;
}
function connectSelectedEntities(index, selectedNames) {
  const selected = uniq(selectedNames).filter((name) => index.entities.has(key(name)));
  if (!selected.length) return { selected:[], nodes:[], edges:[], paths:[], disconnected:[] };
  if (selected.length === 1) return { selected, nodes:[selected[0]], edges:[], paths:[], disconnected:[] };
  const adj = adjacency(index);
  const connectedNames = new Map([[key(selected[0]), selected[0]]]);
  const remaining = new Map(selected.slice(1).map((name) => [key(name), name]));
  const unionNodes = new Map([[key(selected[0]), selected[0]]]), unionEdges = new Map();
  const paths = [], disconnected = [];
  while (remaining.size) {
    let best = null;
    for (const source of connectedNames.values()) {
      for (const target of remaining.values()) {
        const path = shortestPath(adj, source, target);
        if (!path) continue;
        if (!best || path.edges.length < best.path.edges.length) best = { source, target, path };
      }
    }
    if (!best) { disconnected.push(...remaining.values()); break; }
    paths.push(best);
    for (const name of best.path.nodes) unionNodes.set(key(name), name);
    for (const step of best.path.edges) {
      const edge = step.edge;
      const signature = `${key(edge.from)}|${key(edge.to)}|${key(edge.relationship)}|${edge.keyMaps.map((m) => `${key(m.fieldName)}:${key(m.relatedFieldName)}`).join(',')}`;
      unionEdges.set(signature, edge);
    }
    connectedNames.set(key(best.target), best.target);
    remaining.delete(key(best.target));
  }
  return { selected, nodes:[...unionNodes.values()], edges:[...unionEdges.values()], paths, disconnected };
}

function compactSemanticEntity(index, semanticHints, name, includeAllFields = false) {
  const entity = index.entities.get(key(name));
  if (!entity) return null;
  return {
    name:entity.name,
    description:entity.description,
    semanticFields:arr(semanticHints.get(key(entity.name))).map((hint) => ({ term:hint.term, field:hint.field, evidence:hint.evidence })),
    ...(includeAllFields ? { fields:entity.fields.slice(0, 24) } : {})
  };
}
function joinEvidence(edge) {
  return {
    from:edge.from,
    to:edge.to,
    relationship:edge.relationship,
    cardinality:edge.cardinality,
    keyMaps:edge.keyMaps,
    description:edge.description,
    evidenced:true
  };
}
function abstractParentEvidence(index, semanticHints, endpointRoles, name) {
  const role = endpointRoles.get(key(name));
  if (role?.role !== 'abstract_parent') return null;
  const entity = index.entities.get(key(name));
  return {
    role:'abstract_parent',
    concreteInstances:arr(role.concreteInstances),
    description:entity?.description || '',
    semanticFields:arr(semanticHints.get(key(name))).map((hint) => ({ term:hint.term, field:hint.field, evidence:hint.evidence }))
  };
}
function abstractSideJoinEvidence(edge, visibleEntity) {
  const visibleIsFrom = key(edge?.from) === key(visibleEntity);
  return {
    entity:visibleEntity,
    relationship:edge?.relationship || 'related to',
    cardinality:edge?.cardinality || 'unknown',
    keyMaps:arr(edge?.keyMaps).map((map) => visibleIsFrom
      ? { entityField:map.fieldName, abstractField:map.relatedFieldName || map.fieldName, implicit:!!map.implicit }
      : { entityField:map.relatedFieldName || map.fieldName, abstractField:map.fieldName, implicit:!!map.implicit }),
    description:edge?.description || '',
    evidenced:true
  };
}
function collapsedAbstractConnections(index, semanticHints, endpointRoles, rawNodes, rawEdges) {
  const result = [];
  for (let i = 1; i < rawNodes.length - 1; i += 1) {
    const abstractName = rawNodes[i];
    if (endpointRoles.get(key(abstractName))?.role !== 'abstract_parent') continue;
    const left = rawNodes[i - 1], right = rawNodes[i + 1];
    const leftEdge = rawEdges[i - 1], rightEdge = rawEdges[i];
    if (!leftEdge || !rightEdge) continue;
    result.push({
      from:left,
      to:right,
      viaAbstractParent:abstractParentEvidence(index, semanticHints, endpointRoles, abstractName),
      leftJoin:abstractSideJoinEvidence(leftEdge, left),
      rightJoin:abstractSideJoinEvidence(rightEdge, right),
      evidenced:true
    });
  }
  return result;
}
function presentPath(index, semanticHints, endpointRoles, record) {
  const rawNodes = arr(record?.path?.nodes);
  const rawEdges = arr(record?.path?.edges).map((step) => step.edge);
  const visibleNodes = [];
  const abstractParents = [];
  for (const name of rawNodes) {
    const role = endpointRoles.get(key(name));
    if (role?.role === 'abstract_parent') {
      const evidence = abstractParentEvidence(index, semanticHints, endpointRoles, name);
      if (evidence) abstractParents.push(evidence);
      continue;
    }
    visibleNodes.push(name);
  }
  return {
    from:record.source,
    to:record.target,
    concretePath:visibleNodes,
    joins:rawEdges.filter((edge) => {
      const fromRole = endpointRoles.get(key(edge.from)), toRole = endpointRoles.get(key(edge.to));
      return fromRole?.role !== 'abstract_parent' && toRole?.role !== 'abstract_parent';
    }).map(joinEvidence),
    collapsedAbstractConnections:collapsedAbstractConnections(index, semanticHints, endpointRoles, rawNodes, rawEdges),
    viaAbstractParents:abstractParents,
    rawHopCount:rawEdges.length
  };
}
function isolatedNeighbourhood(index, semanticHints, endpointRoles, disconnectedNames) {
  const adj = adjacency(index);
  return arr(disconnectedNames).map((name) => {
    const selectedEntity = compactSemanticEntity(index, semanticHints, name, false);
    const neighbours = arr(adj.get(key(name))).slice(0, MAX_ISOLATED_NEIGHBOURS).map((step) => {
      const role = endpointRoles.get(key(step.to));
      if (role?.role === 'abstract_parent') {
        return {
          abstractParent:abstractParentEvidence(index, semanticHints, endpointRoles, step.to),
          link:abstractSideJoinEvidence(step.edge, name)
        };
      }
      return { entity:compactSemanticEntity(index, semanticHints, step.to, false), link:joinEvidence(step.edge) };
    }).filter((item) => item.entity || item.abstractParent);
    return { selectedEntity, neighbours };
  }).filter((item) => item.selectedEntity);
}
function groundedSlice(index, semanticHints, endpointRoles, connection) {
  const concreteEntities = connection.nodes.filter((name) => endpointRoles.get(key(name))?.role !== 'abstract_parent');
  const paths = connection.paths.map((record) => presentPath(index, semanticHints, endpointRoles, record));
  return {
    selectedEntities:connection.selected,
    disconnectedSelectedEntities:connection.disconnected,
    entities:concreteEntities.map((name) => {
      const entity = index.entities.get(key(name));
      return { name:entity.name, description:entity.description, fields:entity.fields.slice(0, 24) };
    }),
    connectionPaths:paths,
    joins:connection.edges.filter((edge) => {
      const fromRole = endpointRoles.get(key(edge.from)), toRole = endpointRoles.get(key(edge.to));
      return fromRole?.role !== 'abstract_parent' && toRole?.role !== 'abstract_parent';
    }).map(joinEvidence),
    isolatedEntityNeighbourhoods:isolatedNeighbourhood(index, semanticHints, endpointRoles, connection.disconnected)
  };
}

export async function runTwoPassQuery({ question, client, model, graph, directory, log = () => {} }) {
  const usage = { prompt:0, completion:0, total:0 };
  const index = graphIndex(graph);
  const semanticHints = semanticFieldHints(index.entities);
  const endpointRoles = queryEndpointRoles(index);
  const groups = groupsForIntent(directory);
  console.log(`[lemap query-v2] pass 1 intent: ${groups.length} groups`);
  log('query_v2_pass1_payload', { question, groups });
  const pass1 = await modelJson(client, model,
    'Parse the user question into stable canonical business requirements and select every business directory group that is plausibly needed to satisfy those requirements. Use each group description, its abstract/base members, representative concrete members, composition, and evidenced relationships to other groups as semantic evidence. Select groups whose members can directly represent the requested business data or whose business associations are themselves necessary to express it. Do not select a group merely because it is generally associated with the data. Do not choose database fields or entities. Coverage matters more than minimizing groups. Return {"intent":"short business intent","requirements":[{"concept":"canonical business concept","role":"measure|dimension|time|filter|attribute|key|derived","value":"optional"}],"relevantGroups":["exact supplied group names"],"interpretation":"one sentence"}.',
    { question, groups });
  addUsage(usage, pass1.usage);
  const validGroups = new Map(groups.map((group) => [key(group.name), group.name]));
  const relevantGroups = uniq(arr(pass1.parsed?.relevantGroups).map((name) => validGroups.get(key(name))).filter(Boolean));
  const requirements = arr(pass1.parsed?.requirements).slice(0, 12).map((item) => ({ concept:text(item?.concept, 100), role:text(item?.role, 30), value:text(item?.value, 120) })).filter((item) => item.concept);
  const intent = { intent:text(pass1.parsed?.intent, 160), interpretation:text(pass1.parsed?.interpretation, 260), requirements, relevantGroups };
  console.log(`[lemap query-v2] pass 1 groups: ${relevantGroups.join(', ') || '(none)'}; requirements: ${requirements.map((r) => r.concept).join(', ') || '(none)'}; tokens ${pass1.usage.total}`);
  log('query_v2_intent', { question, intent, usage:pass1.usage });

  const candidateSet = directoryCandidateEntities(directory, relevantGroups, index.entities, semanticHints, endpointRoles);
  const candidates = candidateSet.candidates, excluded = candidateSet.excluded;
  const abstractCount = excluded.filter((item) => item.role === 'abstract_parent').length;
  const associationCount = candidates.filter((item) => item.semanticRole === 'association_entity').length;
  console.log(`[lemap query-v2] cluster candidate filter: ${excluded.length} abstract parents omitted from model; ${associationCount} association entities remain selectable`);
  console.log(`[lemap query-v2] pass 2 entity selection: ${candidates.length} selectable entities from selected clusters`);
  const pass2 = await modelJson(client, model,
    'Select the smallest sufficient set of physical entities that directly satisfy ALL canonical requirements. Abstract/base parents are intentionally absent; LeMap can traverse them later. Candidates marked association_entity are valid semantic choices when the business meaning lies in an association such as an order-to-contact, party-to-address, shipment-to-source, or similar relationship; do not reject them merely because they contain mostly identifiers. Candidates marked concrete_entity carry concrete business values. Choose an entity only when its OWN name, description, association meaning, or compact semantic field evidence directly represents the requirement. Do not choose joins and do not invent fields. Return {"selectedEntities":[{"entity":"exact candidate entity name","covers":["requirement concepts"],"reason":"short evidence-based semantic reason"}],"uncoveredRequirements":["concepts not directly represented by any candidate"]}.',
    { question, logicalRequest:intent, candidates });
  addUsage(usage, pass2.usage);
  const candidateNames = new Map(candidates.map((item) => [key(item.name), item.name]));
  const selectedEntities = uniq(arr(pass2.parsed?.selectedEntities).map((item) => candidateNames.get(key(item?.entity))).filter(Boolean)).slice(0, 8);
  const selections = arr(pass2.parsed?.selectedEntities).map((item) => ({ entity:candidateNames.get(key(item?.entity)) || '', covers:arr(item?.covers).map(String), reason:text(item?.reason, 220) })).filter((item) => item.entity);
  console.log(`[lemap query-v2] pass 2 selected: ${selectedEntities.join(', ') || '(none)'}; tokens ${pass2.usage.total}`);
  log('query_v2_entities', { selectedEntities:selections, uncoveredRequirements:arr(pass2.parsed?.uncoveredRequirements), candidateCount:candidates.length, excludedCandidateCount:excluded.length, excludedCandidates:excluded, associationCandidateCount:associationCount, usage:pass2.usage });

  const connection = connectSelectedEntities(index, selectedEntities);
  const slice = groundedSlice(index, semanticHints, endpointRoles, connection);
  const abstractViaCount = slice.connectionPaths.reduce((sum, path) => sum + path.viaAbstractParents.length, 0);
  const collapsedAbstractConnectionCount = slice.connectionPaths.reduce((sum, path) => sum + path.collapsedAbstractConnections.length, 0);
  const isolatedNeighbourCount = slice.isolatedEntityNeighbourhoods.reduce((sum, item) => sum + item.neighbours.length, 0);
  console.log(`[lemap query-v2] local graph: ${slice.entities.length} presented entities, ${slice.connectionPaths.length} connection paths, ${abstractViaCount} abstract-parent hops collapsed into ${collapsedAbstractConnectionCount} evidenced connections${connection.disconnected.length ? `; isolated selected: ${connection.disconnected.join(', ')} with ${isolatedNeighbourCount} one-hop neighbours` : ''}`);
  log('query_v2_local_graph', { selectedEntities, presentedEntities:slice.entities.map((e) => e.name), connectionPaths:slice.connectionPaths, joins:slice.joins, disconnected:connection.disconnected, isolatedEntityNeighbourhoods:slice.isolatedEntityNeighbourhoods });

  const finalCall = await modelJson(client, model,
    'Answer the business question using ONLY the supplied grounded graph evidence. The entities list excludes abstract/base parents but may include meaningful association entities. connectionPaths show how selected entities connect. Normal joins are direct evidenced FKs. collapsedAbstractConnections are ALSO valid evidenced physical connections: the hidden abstract parent is structural only, while leftJoin and rightJoin preserve the actual key mappings from each visible entity to that hidden parent. Use these connections to judge semantics and connectivity, but never select, group by, or present the abstract parent as a concrete business entity. viaAbstractParents provides structural inheritance/base semantics only. Use only supplied evidenced joins/connections and never invent a field or join. If evidence is insufficient, say exactly what is missing. Return {"answer":"concise answer about the available data/view","dataView":{"grain":"result level","select":[{"entity":"","field":"","role":"measure|dimension|time|filter|attribute|key|derived"}],"joins":[{"left":"Entity.field","right":"Entity.field","relation":"","evidenced":true}],"groupBy":["Entity.field"],"orderBy":[{"field":"Entity.field or derived expression","direction":"asc|desc"}],"filters":[],"derived":[{"name":"","expression":"business-level expression using observed fields"}],"missing":[]},"nextStep":"optional"}.',
    { question, logicalRequest:intent, entitySelections:selections, groundedGraph:slice });
  addUsage(usage, finalCall.usage);
  console.log(`[lemap query-v2] final answer tokens ${finalCall.usage.total}; total ${usage.total}`);
  log('query_v2_answer', { response:finalCall.parsed, usage:finalCall.usage, cumulativeUsage:usage });

  return {
    ...finalCall.parsed,
    investigation:{
      mode:'two-pass-cluster-graph-selectable-associations-local-paths-collapsed-abstract-joins',
      logicalRequest:intent,
      relevantGroups,
      candidateEntityCount:candidates.length,
      excludedCandidateCount:excluded.length,
      excludedCandidates:excluded,
      selectedEntities:selections,
      localGraph:{
        entityCount:slice.entities.length,
        entities:slice.entities.map((entity) => entity.name),
        connectionPaths:slice.connectionPaths,
        joins:slice.joins,
        disconnectedSelectedEntities:connection.disconnected,
        isolatedEntityNeighbourhoods:slice.isolatedEntityNeighbourhoods
      },
      usage
    }
  };
}
