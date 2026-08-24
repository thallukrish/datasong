const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 240) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];

const MAX_SEMANTIC_FIELDS = 5;
const MAX_ISOLATED_NEIGHBOURS = 12;
const MAX_PATH_HOPS = 7;
const ENTITY_BROWSER_LEAF_SIZE = 8;
const ENTITY_BROWSER_MAX_ROUNDS = 12;

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
    messages:[
      { role:'system', content:`Return JSON only. ${system}` },
      { role:'user', content:JSON.stringify(payload) }
    ],
    response_format:{ type:'json_object' },
    thinking:{ type:'disabled' },
    temperature:0
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  return { parsed:parseJson(raw), usage:usageOf(completion.usage || {}) };
}

async function modelJsonWithStaticPrefix(client, model, system, staticPayload, dynamicPayload) {
  const completion = await client.chat.completions.create({
    model,
    messages:[
      { role:'system', content:`Return JSON only. ${system}` },
      { role:'user', content:JSON.stringify(staticPayload) },
      { role:'user', content:JSON.stringify(dynamicPayload) }
    ],
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

  const n = Math.max(entities.length, 1);
  const result = new Map();
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
  const from = index.entities.get(key(edge?.from));
  const to = index.entities.get(key(edge?.to));
  if (!from || !to || !arr(edge?.keyMaps).length) return false;
  const fromPk = pkNames(from);
  const toPk = pkNames(to);
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
    if (!subtypeChildren.has(parentKey)) subtypeChildren.set(parentKey, new Map());
    subtypeChildren.get(parentKey).set(key(edge.from), edge.from);
  }

  const roles = new Map();
  for (const entity of index.entities.values()) {
    const k = key(entity.name);
    const children = subtypeChildren.get(k) || new Map();
    if (children.size >= 2) {
      roles.set(k, {
        role:'abstract_parent', querySelectable:false,
        concreteInstances:[...children.values()].sort(),
        reason:`shared PK parent of ${children.size} concrete subtype entities`
      });
    } else if (!hasConcreteValueField(entity) && Number(degree.get(k) || 0) > 0) {
      roles.set(k, {
        role:'association_entity', querySelectable:true, concreteInstances:[],
        reason:'identifier-centric relationship/association entity; may carry business meaning through the association itself'
      });
    } else {
      roles.set(k, { role:'concrete_entity', querySelectable:true, concreteInstances:[], reason:'has concrete business value fields' });
    }
  }
  return roles;
}

function groupsForIntent(directory) {
  return arr(directory?.groups).map((group) => ({
    name:group.name,
    description:group.baseDescription || group.description || '',
    composition:group.composition || null,
    abstractEntities:arr(group.abstractEntities).map((item) => ({
      name:item?.name || '', description:item?.description || '', concreteInstances:arr(item?.concreteInstances)
    })).filter((item) => item.name),
    representativeConcreteEntities:arr(group.representativeConcreteEntities).map((item) => ({
      name:item?.name || '', description:item?.description || ''
    })).filter((item) => item.name),
    relatedGroups:arr(group.relatedGroups).map((item) => ({
      group:item?.group || '', strength:item?.strength || '', pairCount:Number(item?.pairCount || 0), bridges:arr(item?.bridges)
    })).filter((item) => item.group)
  }));
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
      const endpoint = endpointRoles.get(key(graphEntity.name)) || { role:'concrete_entity', querySelectable:true, concreteInstances:[], reason:'' };
      if (!endpoint.querySelectable) {
        excluded.set(key(graphEntity.name), {
          name:graphEntity.name, role:endpoint.role, concreteInstances:endpoint.concreteInstances, reason:endpoint.reason
        });
        continue;
      }
      let item = byEntity.get(key(graphEntity.name));
      if (!item) {
        item = {
          name:graphEntity.name,
          description:graphEntity.description,
          semanticRole:endpoint.role,
          groups:[],
          semanticFields:arr(semanticHints.get(key(graphEntity.name))).map((hint) => ({
            term:hint.term, field:hint.field, evidence:hint.evidence
          }))
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

function entityNameParts(name) {
  return String(name || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}
function groupIdPart(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'other';
}
function initialEntityBranches(candidates) {
  const grouped = new Map();
  for (const candidate of candidates) {
    const parts = entityNameParts(candidate.name);
    const token = parts[0] || 'Other';
    const k = key(token) || 'other';
    if (!grouped.has(k)) grouped.set(k, { token, candidates:[] });
    grouped.get(k).candidates.push(candidate);
  }
  return [...grouped.values()].map(({ token, candidates:items }) => ({
    id:`entity:${groupIdPart(token)}`,
    label:`${token}*`,
    prefixParts:[token],
    candidates:items.sort((a, b) => a.name.localeCompare(b.name))
  })).sort((a, b) => a.label.localeCompare(b.label));
}
function lexicalChunks(branch) {
  const sorted = [...branch.candidates].sort((a, b) => a.name.localeCompare(b.name));
  const chunks = [];
  for (let i = 0; i < sorted.length; i += ENTITY_BROWSER_LEAF_SIZE) {
    const items = sorted.slice(i, i + ENTITY_BROWSER_LEAF_SIZE);
    const first = items[0]?.name || 'A';
    const last = items.at(-1)?.name || first;
    chunks.push({
      id:`${branch.id}/range-${Math.floor(i / ENTITY_BROWSER_LEAF_SIZE) + 1}`,
      label:`${first} … ${last}`,
      prefixParts:branch.prefixParts,
      candidates:items
    });
  }
  return chunks;
}
function subdivideEntityBranch(branch) {
  if (branch.candidates.length <= ENTITY_BROWSER_LEAF_SIZE) return [];
  const tokenized = branch.candidates.map((candidate) => ({ candidate, parts:entityNameParts(candidate.name) }));
  const maxDepth = Math.max(...tokenized.map((item) => item.parts.length), branch.prefixParts.length);
  const workingPrefix = [...branch.prefixParts];
  const skippedSharedParts = [];
  let depth = workingPrefix.length;

  while (depth < maxDepth) {
    const distinct = new Map();
    for (const item of tokenized) {
      const token = item.parts[depth] || '(exact)';
      const k = key(token) || 'exact';
      if (!distinct.has(k)) distinct.set(k, { token, candidates:[] });
      distinct.get(k).candidates.push(item.candidate);
    }

    if (distinct.size === 1) {
      const only = [...distinct.values()][0];
      if (only.token === '(exact)') break;
      workingPrefix.push(only.token);
      skippedSharedParts.push(only.token);
      depth += 1;
      continue;
    }

    return [...distinct.values()].map(({ token, candidates:items }) => {
      const exact = token === '(exact)';
      const prefixParts = exact ? workingPrefix : [...workingPrefix, token];
      const idSuffixParts = [...skippedSharedParts, exact ? 'exact' : token].map(groupIdPart);
      return {
        id:`${branch.id}/${idSuffixParts.join('/')}`,
        label:exact ? `${workingPrefix.join('')} (exact)` : `${prefixParts.join('')}*`,
        prefixParts,
        candidates:items.sort((a, b) => a.name.localeCompare(b.name))
      };
    }).sort((a, b) => a.label.localeCompare(b.label));
  }

  return lexicalChunks({ ...branch, prefixParts:workingPrefix });
}
function compactEntityForBrowser(candidate) {
  return {
    name:candidate.name,
    description:candidate.description,
    semanticRole:candidate.semanticRole,
    groups:candidate.groups,
    semanticFields:candidate.semanticFields
  };
}
function branchForRefinement(branch) {
  const leaf = branch.candidates.length <= ENTITY_BROWSER_LEAF_SIZE;
  return {
    id:branch.id,
    label:branch.label,
    entityCount:branch.candidates.length,
    ...(leaf ? {
      kind:'entity_set',
      entities:branch.candidates.map(compactEntityForBrowser)
    } : {
      kind:'branch',
      examples:branch.candidates.slice(0, 4).map((item) => item.name)
    })
  };
}
function expandRetainedBranch(branch) {
  if (branch.candidates.length <= ENTITY_BROWSER_LEAF_SIZE) return [];
  const children = subdivideEntityBranch(branch);
  return children.length ? children : lexicalChunks(branch);
}

async function browseCandidateEntities({ question, intent, candidates, client, model, log, usage }) {
  const candidateNames = new Map(candidates.map((item) => [key(item.name), item]));
  const selected = new Map();
  let frontier = initialEntityBranches(candidates);
  let uncoveredRequirements = arr(intent?.requirements).map((item) => item.concept).filter(Boolean);
  const rounds = [];
  let totalDroppedBranches = 0;

  const browserSystem = 'Progressively refine candidate entity-name branches until enough semantic entity evidence is visible to choose an answerable entity set. LeMap only organizes names mechanically; YOU own every semantic keep/drop decision. currentBranches is the entire active frontier for this round. For a kind=branch item, retain its exact id only if that name branch plausibly corresponds to an unresolved requirement; retained large branches will be expanded by exactly one hierarchy level next round. Branches you do not retain are discarded because of your semantic decision, not by LeMap. For a kind=entity_set item, full entity descriptions and semantic field hints are already visible: select relevant entities now using exact names. Selected entities are GLOBAL PINNED selections and persist across later refinement rounds unless you explicitly drop them. Do not retain an entity_set merely to see the same evidence again. You may continue refining other branches after selecting entities. Set done=true only when pinned selections appear sufficient for every logical requirement. If unresolved requirements remain, retain only the branches that plausibly address those requirements. Do not keep branches merely because they might contain something; use the names as semantic signals and narrow deliberately. Field-name resemblance alone is insufficient when selecting actual entities; use their descriptions/evidence and reject contradictory evidence. Return {"retainBranchIds":["exact ids of kind=branch items to refine"],"selectEntities":[{"entity":"exact entity name from visible entity_set","covers":["requirement concepts"],"reason":"short semantic reason"}],"dropEntities":["exact pinned entity names to remove"],"uncoveredRequirements":["still uncovered or uncertain concepts"],"done":true|false,"reason":"short refinement decision"}.';

  const staticPayload = {
    task:'query_v2_progressive_entity_refinement',
    question,
    logicalRequest:intent,
    responseContract:{
      retainBranchIds:'kind=branch ids to expand one level',
      selectEntities:'relevant entities from visible kind=entity_set branches',
      dropEntities:'currently pinned entities to remove explicitly',
      uncoveredRequirements:'still uncovered or uncertain concepts',
      done:'boolean',
      reason:'short refinement decision'
    }
  };

  for (let round = 1; round <= ENTITY_BROWSER_MAX_ROUNDS; round++) {
    const visible = frontier.map(branchForRefinement);
    const visibleEntityKeys = new Set(
      frontier
        .filter((branch) => branch.candidates.length <= ENTITY_BROWSER_LEAF_SIZE)
        .flatMap((branch) => branch.candidates.map((candidate) => key(candidate.name)))
    );
    const branchById = new Map(frontier.map((branch) => [branch.id, branch]));

    const dynamicPayload = {
      refinementState:{
        currentBranches:visible,
        selectedEntities:[...selected.values()],
        uncoveredRequirements
      }
    };

    log('query_v2_entity_browser_payload', {
      round,
      staticPrefix:staticPayload,
      dynamicSuffix:dynamicPayload
    });
    console.log(`[lemap query-v2] entity refinement round ${round}: ${frontier.length} active branches, ${visible.filter((item) => item.kind === 'entity_set').length} entity sets, ${selected.size} pinned selections`);

    const call = await modelJsonWithStaticPrefix(client, model, browserSystem, staticPayload, dynamicPayload);
    addUsage(usage, call.usage);

    for (const name of arr(call.parsed?.dropEntities)) selected.delete(key(name));
    for (const item of arr(call.parsed?.selectEntities)) {
      const candidate = candidateNames.get(key(item?.entity));
      if (!candidate || !visibleEntityKeys.has(key(candidate.name))) continue;
      selected.set(key(candidate.name), {
        entity:candidate.name,
        covers:arr(item?.covers).map(String),
        reason:text(item?.reason, 220)
      });
    }
    uncoveredRequirements = arr(call.parsed?.uncoveredRequirements).map(String);

    const retainIds = uniq(arr(call.parsed?.retainBranchIds).map(String))
      .filter((id) => branchById.has(id) && branchById.get(id).candidates.length > ENTITY_BROWSER_LEAF_SIZE);
    const retained = retainIds.map((id) => branchById.get(id));
    const nextFrontier = retained.flatMap(expandRetainedBranch);
    const droppedThisRound = frontier.filter((branch) => branch.candidates.length > ENTITY_BROWSER_LEAF_SIZE && !retainIds.includes(branch.id)).length;
    totalDroppedBranches += droppedThisRound;

    const record = {
      round,
      activeBranchCount:frontier.length,
      visibleEntitySetCount:visible.filter((item) => item.kind === 'entity_set').length,
      retainedBranchIds:retainIds,
      nextBranchCount:nextFrontier.length,
      droppedBranchCount:droppedThisRound,
      selectedEntities:[...selected.values()],
      uncoveredRequirements,
      done:!!call.parsed?.done,
      reason:text(call.parsed?.reason, 260),
      usage:call.usage
    };
    rounds.push(record);
    log('query_v2_entity_browser_round', record);

    if (!!call.parsed?.done) break;
    if (!nextFrontier.length) {
      console.log('[lemap query-v2] entity refinement stopped: no retained branch remains to refine');
      break;
    }
    frontier = nextFrontier;
  }

  return {
    selections:[...selected.values()],
    selectedEntities:[...selected.values()].map((item) => item.entity).slice(0, 8),
    uncoveredRequirements,
    rounds,
    finalFrontier:frontier.map((branch) => ({ id:branch.id, label:branch.label, entityCount:branch.candidates.length })),
    totalDroppedBranches
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
  if (!selected.length) return { selected:[], nodes:[], edges:[], paths:[], disconnected:[] };
  if (selected.length === 1) return { selected, nodes:[selected[0]], edges:[], paths:[], disconnected:[] };

  const adj = adjacency(index);
  const connectedNames = new Map([[key(selected[0]), selected[0]]]);
  const remaining = new Map(selected.slice(1).map((name) => [key(name), name]));
  const unionNodes = new Map([[key(selected[0]), selected[0]]]);
  const unionEdges = new Map();
  const paths = [];
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
function collapsedAbstractSegments(index, semanticHints, endpointRoles, rawNodes, rawEdges) {
  const segments = [];
  for (let i = 0; i < rawNodes.length; i++) {
    const name = rawNodes[i];
    if (endpointRoles.get(key(name))?.role !== 'abstract_parent') continue;
    const incoming = i > 0 ? rawEdges[i - 1] : null;
    const outgoing = i < rawEdges.length ? rawEdges[i] : null;
    const left = i > 0 ? rawNodes[i - 1] : '';
    const right = i + 1 < rawNodes.length ? rawNodes[i + 1] : '';
    segments.push({
      left,
      right,
      viaAbstractParent:abstractParentEvidence(index, semanticHints, endpointRoles, name),
      leftJoin:incoming ? joinEvidence(incoming) : null,
      rightJoin:outgoing ? joinEvidence(outgoing) : null,
      note:'Physical connectivity through a hidden abstract/base entity. Do not treat this as a synthetic direct business join between visible endpoints.'
    });
  }
  return segments;
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
    } else {
      visibleNodes.push(name);
    }
  }

  return {
    from:record.source,
    to:record.target,
    concretePath:visibleNodes,
    joins:rawEdges.filter((edge) => {
      const fromRole = endpointRoles.get(key(edge.from));
      const toRole = endpointRoles.get(key(edge.to));
      return fromRole?.role !== 'abstract_parent' && toRole?.role !== 'abstract_parent';
    }).map(joinEvidence),
    collapsedAbstractSegments:collapsedAbstractSegments(index, semanticHints, endpointRoles, rawNodes, rawEdges),
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
        return { abstractParent:abstractParentEvidence(index, semanticHints, endpointRoles, step.to), link:joinEvidence(step.edge) };
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
      const fromRole = endpointRoles.get(key(edge.from));
      const toRole = endpointRoles.get(key(edge.to));
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
    'Parse the user question into stable canonical business requirements and select every business directory group plausibly needed to satisfy them. Each group is structured: description is the cluster business summary; composition describes member makeup; abstractEntities lists abstract/base members and concrete instances; representativeConcreteEntities contains representative concrete members; relatedGroups contains evidenced cross-cluster links and bridge pairs. Use these fields separately rather than inferring from group name alone. Select groups whose members can directly represent requested data or whose associations are necessary. Do not choose fields or entities. Coverage matters more than minimizing groups. Return {"intent":"short business intent","requirements":[{"concept":"canonical business concept","role":"measure|dimension|time|filter|attribute|key|derived","value":"optional"}],"relevantGroups":["exact supplied group names"],"interpretation":"one sentence"}.',
    { question, groups });
  addUsage(usage, pass1.usage);

  const validGroups = new Map(groups.map((group) => [key(group.name), group.name]));
  const relevantGroups = uniq(arr(pass1.parsed?.relevantGroups).map((name) => validGroups.get(key(name))).filter(Boolean));
  const requirements = arr(pass1.parsed?.requirements).slice(0, 12).map((item) => ({
    concept:text(item?.concept, 100), role:text(item?.role, 30), value:text(item?.value, 120)
  })).filter((item) => item.concept);
  const intent = {
    intent:text(pass1.parsed?.intent, 160),
    interpretation:text(pass1.parsed?.interpretation, 260),
    requirements,
    relevantGroups
  };

  console.log(`[lemap query-v2] pass 1 groups: ${relevantGroups.join(', ') || '(none)'}; requirements: ${requirements.map((r) => r.concept).join(', ') || '(none)'}; tokens ${pass1.usage.total}`);
  log('query_v2_intent', { question, intent, usage:pass1.usage });

  const candidateSet = directoryCandidateEntities(directory, relevantGroups, index.entities, semanticHints, endpointRoles);
  const candidates = candidateSet.candidates;
  const excluded = candidateSet.excluded;
  const abstractCount = excluded.filter((item) => item.role === 'abstract_parent').length;
  console.log(`[lemap query-v2] cluster candidate filter: ${excluded.length} abstract parents omitted from model (${abstractCount} abstract parents)`);
  console.log(`[lemap query-v2] pass 2 progressive entity refinement: ${candidates.length} selectable concrete/association entities remain reachable`);

  const browser = await browseCandidateEntities({ question, intent, candidates, client, model, log, usage });
  const selectedEntities = browser.selectedEntities;
  const selections = browser.selections;

  console.log(`[lemap query-v2] pass 2 selected: ${selectedEntities.join(', ') || '(none)'}; refinement rounds ${browser.rounds.length}; final frontier ${browser.finalFrontier.length}`);
  log('query_v2_entities', {
    selectedEntities:selections,
    uncoveredRequirements:browser.uncoveredRequirements,
    candidateCount:candidates.length,
    excludedCandidateCount:excluded.length,
    excludedCandidates:excluded,
    browserRounds:browser.rounds.length,
    totalDroppedBranches:browser.totalDroppedBranches,
    finalFrontier:browser.finalFrontier
  });

  const connection = connectSelectedEntities(index, selectedEntities);
  const slice = groundedSlice(index, semanticHints, endpointRoles, connection);
  const abstractViaCount = slice.connectionPaths.reduce((sum, path) => sum + path.viaAbstractParents.length, 0);
  const isolatedNeighbourCount = slice.isolatedEntityNeighbourhoods.reduce((sum, item) => sum + item.neighbours.length, 0);
  console.log(`[lemap query-v2] local graph: ${slice.entities.length} presented concrete/association entities, ${slice.connectionPaths.length} connection paths, ${abstractViaCount} abstract-parent hops collapsed${connection.disconnected.length ? `; isolated selected: ${connection.disconnected.join(', ')} with ${isolatedNeighbourCount} one-hop neighbours` : ''}`);
  log('query_v2_local_graph', {
    selectedEntities,
    presentedEntities:slice.entities.map((e) => e.name),
    connectionPaths:slice.connectionPaths,
    joins:slice.joins,
    disconnected:connection.disconnected,
    isolatedEntityNeighbourhoods:slice.isolatedEntityNeighbourhoods
  });

  const finalCall = await modelJson(client, model,
    'Answer the business question using ONLY supplied grounded graph evidence. entities excludes abstract parents. connectionPaths show physical connectivity. collapsedAbstractSegments preserve true FK edges through hidden abstract/base parents and are connectivity evidence only; never rewrite them as synthetic direct joins. Use only supplied evidenced joins and never invent a field or join. The selected entities and joins must collectively form a semantically valid data slice capable of answering the logical request; otherwise state what semantic entity/path is missing. Return {"answer":"concise answer about available data/view","dataView":{"grain":"result level","select":[{"entity":"","field":"","role":"measure|dimension|time|filter|attribute|key|derived"}],"joins":[{"left":"Entity.field","right":"Entity.field","relation":"","evidenced":true}],"groupBy":["Entity.field"],"orderBy":[{"field":"Entity.field or derived expression","direction":"asc|desc"}],"filters":[],"derived":[{"name":"","expression":"business-level expression using observed fields"}],"missing":[]},"nextStep":"optional"}.',
    { question, logicalRequest:intent, entitySelections:selections, groundedGraph:slice });
  addUsage(usage, finalCall.usage);

  console.log(`[lemap query-v2] final answer tokens ${finalCall.usage.total}; total ${usage.total}`);
  log('query_v2_answer', { response:finalCall.parsed, usage:finalCall.usage, cumulativeUsage:usage });

  return {
    ...finalCall.parsed,
    investigation:{
      mode:'two-pass-structured-clusters-progressive-model-refinement-local-paths',
      logicalRequest:intent,
      relevantGroups,
      candidateEntityCount:candidates.length,
      excludedCandidateCount:excluded.length,
      excludedCandidates:excluded,
      entityBrowser:{
        rounds:browser.rounds.length,
        totalDroppedBranches:browser.totalDroppedBranches,
        finalFrontier:browser.finalFrontier,
        uncoveredRequirements:browser.uncoveredRequirements
      },
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
