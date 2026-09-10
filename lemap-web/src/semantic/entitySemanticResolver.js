import { callJsonModel } from './modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 600) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function bool(value, fallback = false) { return value === undefined ? fallback : !!value; }
function priority(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(100, Math.round(n)));
}

const SCOPES = new Set(['local', 'global']);
const INTERACTIONS = new Set(['user_input', 'information', 'action', 'navigation', 'unknown']);
const WORKFLOW_ROLES = new Set(['continue', 'back', 'branch', 'global', 'exit', 'commit', 'local', 'unknown']);
const CONSEQUENCES = new Set(['reversible', 'commit', 'financial', 'destructive', 'security', 'unknown']);
const SELECTION_RULES = new Set(['exactlyOne', 'anyOf', 'allOf', 'atLeastOne']);

const SYSTEM = `You are DataSong LeMap-Web's entity semantic interpreter.
LeMap-Web already owns the complete structural entity graph. You receive only entities that still need semantic interpretation plus the user's goal and current page context.
The pageContext object, when present, is reference-only context for interpreting the supplied entities. Do not return semantic patches for pageContext unless that same page entity is also explicitly included in entities.
For each supplied entity, return only its id and semantic additions. Never repeat structural facts, option lists, links, browser mechanics or user values. Never invent entity ids.
A group entity represents one user-facing choice independent of how its member controls are rendered. Member controls inside a supplied group are structural implementation details and are not separate semantic questions.
For group entities, structural cardinality describes what the UI permits. Add selectionRule only when useful to express the business meaning: exactlyOne, anyOf, allOf, or atLeastOne. Do not infer the grouping from widget type; LeMap-Web has already done that structurally.
For every relevant actionable control on the current page, classify its significance relative to the active workflow. Use workflowRole=continue only for the best direct forward actions that advance the current goal; back for navigation to an earlier workflow step; branch for a goal-relevant alternate path; global for top-level/site-wide navigation; exit for leaving or abandoning the active workflow; commit for a final/consequential action; local for relevant non-navigation local actions; unknown when uncertain. Add navigationPriority from 0 to 100 for action/navigation controls, where higher means more appropriate as the next action from the current page for this goal. Rank direct forward workflow controls above breadcrumbs, help, alternate paths, skip/bypass links, global navigation and exits.
Omit irrelevant entities entirely. For relevant entities, add only useful semantic fields such as meaning, semanticType, scope(local|global), interaction(user_input|information|action|navigation), relevantToGoal, required, question, explanation, caveats, examples, selectionRule(exactlyOne|anyOf|allOf|atLeastOne), workflowRole(continue|back|branch|global|exit|commit|local), navigationPriority(0-100), consequence(reversible|commit|financial|destructive|security), description, complete.
complete is primarily for workflow entities. For actions/navigation, classify consequence. Use reversible only for safe intermediate actions. Mark final/committing actions as workflowRole=commit and consequence=commit or a more specific consequential category.
Return strict JSON only as {entities:[{id,semantic:{...}}]}.`;

function compactEntity(entity = {}) {
  const structural = entity.structural || {};
  const hint = entity.type === 'workflow'
    ? { goal: structural.goal || undefined }
    : entity.type === 'group'
      ? {
          cardinality: structural.cardinality || undefined,
          choices: arr(structural.values).slice(0, 8).map((value) => text(value, 100)).filter(Boolean)
        }
      : entity.type === 'ui_control'
        ? { controlType: structural.controlType || undefined }
        : {};
  const structuralHint = Object.fromEntries(Object.entries(hint).filter(([, value]) => {
    if (value === undefined) return false;
    if (Array.isArray(value) && !value.length) return false;
    return true;
  }));
  return {
    id: String(entity.id || ''),
    name: text(entity.name, 360),
    type: String(entity.type || 'unknown'),
    ...(Object.keys(structuralHint).length ? { structural: structuralHint } : {})
  };
}

function compactPageContext(page = null) {
  if (!page?.id) return undefined;
  return {
    id: String(page.id),
    name: text(page.name, 360),
    type: String(page.type || 'page'),
    ...(page.semantic?.meaning ? { meaning: text(page.semantic.meaning, 360) } : {}),
    ...(page.semantic?.description ? { description: text(page.semantic.description, 500) } : {})
  };
}

function withWorkflow(entities = [], knownWorkflow = null) {
  const all = arr(entities);
  if (!knownWorkflow?.id || all.some((entity) => entity.id === knownWorkflow.id)) return all;
  return [knownWorkflow, ...all];
}

function groupedChoiceMember(entity = {}, byId = new Map()) {
  if (entity?.type !== 'ui_control') return false;
  return arr(entity.links)
    .filter((link) => link.relationship === 'partOf')
    .map((link) => byId.get(link.id))
    .some((group) => group?.type === 'group');
}

export function entitiesNeedingSemantics(entities = []) {
  const all = arr(entities);
  const byId = new Map(all.map((entity) => [entity.id, entity]));
  return all.filter((entity) => {
    if (groupedChoiceMember(entity, byId)) return false;
    const semantic = entity?.semantic || {};
    if (!Object.keys(semantic).length) return true;
    if (entity?.type === 'workflow' && semantic.complete === undefined) return true;
    if (['action', 'navigation'].includes(semantic.interaction) && (!semantic.consequence || semantic.navigationPriority === undefined || !semantic.workflowRole)) return true;
    return false;
  });
}

export function buildEntitySemanticPrompt({ userGoal = '', entities = [], pageId = '', knownWorkflow = null, pageContext = null } = {}) {
  const modelEntities = withWorkflow(entities, knownWorkflow);
  const payload = {
    goal: text(userGoal, 300),
    pageId: String(pageId || ''),
    ...(compactPageContext(pageContext) ? { pageContext: compactPageContext(pageContext) } : {}),
    entities: modelEntities.map(compactEntity)
  };
  return `MODE web-entity-semantics-v1\nUNRESOLVED ENTITIES:\n${JSON.stringify(payload)}\n\nTASK:\nReturn semantic additions only as {entities:[{id,semantic:{...}}]}. Omit irrelevant entities. pageContext is reference only unless the page itself also appears in entities. Interpret action/navigation controls relative to the active workflow and current page: classify workflowRole as continue|back|branch|global|exit|commit|local and assign navigationPriority 0-100. Use continue only for direct forward progress toward the user's goal. A group is one semantic interaction; do not split its choices into separate questions. Use structural cardinality as the UI constraint and add selectionRule only for the business rule. Do not echo structure, values or relationships.`;
}

function normalizeSemantic(raw = {}) {
  const interaction = INTERACTIONS.has(raw.interaction) ? raw.interaction : 'unknown';
  const semantic = {
    meaning: text(raw.meaning, 240),
    semanticType: text(raw.semanticType, 160),
    scope: SCOPES.has(raw.scope) ? raw.scope : undefined,
    interaction,
    relevantToGoal: bool(raw.relevantToGoal, false),
    required: bool(raw.required, false),
    question: text(raw.question, 360),
    explanation: text(raw.explanation, 700),
    caveats: arr(raw.caveats).slice(0, 8).map((item) => text(item, 260)).filter(Boolean),
    examples: arr(raw.examples).slice(0, 8).map((item) => text(item, 180)).filter(Boolean),
    selectionRule: SELECTION_RULES.has(raw.selectionRule) ? raw.selectionRule : undefined,
    workflowRole: WORKFLOW_ROLES.has(raw.workflowRole) ? raw.workflowRole : 'unknown',
    navigationPriority: priority(raw.navigationPriority) ?? (['action', 'navigation'].includes(interaction) ? 0 : undefined),
    consequence: CONSEQUENCES.has(raw.consequence) ? raw.consequence : 'unknown',
    description: text(raw.description, 700)
  };
  if (raw.complete !== undefined) semantic.complete = !!raw.complete;
  return Object.fromEntries(Object.entries(semantic).filter(([, value]) => {
    if (value === undefined || value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

export function normalizeEntitySemanticResponse(raw = {}, knownEntities = []) {
  const known = new Set(arr(knownEntities).map((entity) => entity.id));
  return {
    entities: arr(raw.entities)
      .filter((item) => known.has(String(item?.id || '')))
      .map((item) => ({ id: String(item.id), semantic: normalizeSemantic(item.semantic || {}) }))
  };
}

export async function resolveEntitySemantics({ client, model, userGoal = '', entities = [], pageId = '', knownWorkflow = null, pageContext = null } = {}) {
  const modelEntities = withWorkflow(entities, knownWorkflow);
  const userPrompt = buildEntitySemanticPrompt({ userGoal, entities: modelEntities, pageId, pageContext });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeEntitySemanticResponse(response.parsed, modelEntities);
}
