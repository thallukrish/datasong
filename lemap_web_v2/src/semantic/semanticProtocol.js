const ACTION_TYPES = new Set(['button', 'link']);
const SEMANTIC_KEYS = new Set(['meaning','semanticType','scope','interaction','relevantToGoal','required','question','explanation','caveats','examples','selectionRule','description','complete','workflowRole','navigationPriority','consequence']);

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) { const s = String(value ?? '').replace(/\s+/g, ' ').trim(); return s.slice(0, max); }
function resolved(entity = {}) {
  const s = entity.semantic || {};
  if (!Object.keys(s).length) return false;
  if (entity.type === 'ui_group' && s.relevantToGoal !== false) return s.interaction === 'user_input' && s.required !== undefined && (s.required !== true || !!s.question);
  if (entity.type === 'ui_control' && s.interaction === 'user_input' && s.relevantToGoal === true) return s.required !== undefined && (s.required !== true || !!s.question);
  return true;
}
function groupedChoiceMember(entity = {}, byId = new Map()) {
  if (entity.type !== 'ui_control') return false;
  return arr(entity.links)
    .filter((link) => link.relationship === 'memberOf')
    .map((link) => byId.get(link.id))
    .some((group) => group?.type === 'ui_group');
}
function compactPage(page) {
  if (!page?.id) return undefined;
  return { id: String(page.id), name: text(page.name, 280), ...(page.semantic?.meaning ? { meaning: text(page.semantic.meaning, 280) } : {}) };
}
function compactEntity(entity = {}) {
  const structural = entity.structural || {};
  const out = { id: String(entity.id || ''), name: text(entity.name, 300), type: String(entity.type || 'unknown') };
  if (entity.type === 'ui_control' && structural.controlType) out.controlType = String(structural.controlType);
  if (entity.type === 'ui_group' && structural.cardinality) out.cardinality = String(structural.cardinality);
  const choices = arr(structural.values).slice(0, 12).map((v) => text(v, 120)).filter(Boolean);
  if (choices.length) out.choices = choices;
  return out;
}

export function selectSemanticCandidates(entities = []) {
  const all = arr(entities);
  const byId = new Map(all.map((entity) => [entity?.id, entity]));
  return all.filter((entity) => {
    if (!entity?.id) return false;
    if (entity.type === 'container') return false;
    if (entity.type === 'ui_control' && ACTION_TYPES.has(String(entity.structural?.controlType || ''))) return false;
    if (groupedChoiceMember(entity, byId)) return false;
    if (resolved(entity)) return false;
    return ['ui_control', 'ui_group', 'page', 'workflow'].includes(entity.type);
  });
}

export function buildSemanticRequest({ query = '', workflowPages = [], currentPage = null, entities = [] } = {}) {
  return {
    query: text(query, 300),
    workflowPages: arr(workflowPages).map(compactPage).filter(Boolean),
    ...(compactPage(currentPage) ? { currentPage: compactPage(currentPage) } : {}),
    entities: arr(entities).map(compactEntity).filter((entity) => entity.id)
  };
}

export function normalizeSemanticResponse(raw = {}, allowedEntityIds = []) {
  const allowed = new Set(arr(allowedEntityIds).map(String));
  return arr(raw.entities).flatMap((item) => {
    const id = String(item?.id || '');
    if (!allowed.has(id) || !item?.semantic || typeof item.semantic !== 'object' || Array.isArray(item.semantic)) return [];
    const semantic = {};
    for (const [key, value] of Object.entries(item.semantic)) if (SEMANTIC_KEYS.has(key)) semantic[key] = value;
    return [{ entityId: id, semantic }];
  });
}

export function buildNavigationRequest({ query = '', workflowPages = [], currentPage = null, candidates = [] } = {}) {
  return {
    query: text(query, 300),
    workflowPages: arr(workflowPages).map(compactPage).filter(Boolean),
    ...(compactPage(currentPage) ? { currentPage: compactPage(currentPage) } : {}),
    candidates: arr(candidates).filter((entity) => entity?.id).map((entity) => ({ id: String(entity.id), label: text(entity.name, 260), controlType: String(entity.structural?.controlType || '') }))
  };
}

export function normalizeNavigationResponse(raw = {}, allowedEntityIds = []) {
  const allowed = new Set(arr(allowedEntityIds).map(String));
  const id = String(raw?.selectedEntityId || '');
  return allowed.has(id) ? id : '';
}
