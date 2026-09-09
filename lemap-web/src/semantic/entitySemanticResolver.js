import { callJsonModel } from './modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 600) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function bool(value, fallback = false) { return value === undefined ? fallback : !!value; }

const SCOPES = new Set(['local', 'global']);
const INTERACTIONS = new Set(['user_input', 'information', 'action', 'navigation', 'unknown']);
const WORKFLOW_ROLES = new Set(['continue', 'back', 'commit', 'global', 'local', 'unknown']);
const CONSEQUENCES = new Set(['reversible', 'commit', 'financial', 'destructive', 'security', 'unknown']);

const SYSTEM = `You are DataSong LeMap-Web's entity semantic interpreter.
LeMap-Web already discovered application structure deterministically. You receive a compact semantic view of entity ids, names, types, selected structural facts and relationships for the current rendered context plus the user's goal.
Every supplied item, including a workflow, is an entity. Add business/user-facing meaning only to those entity ids. Do not repeat structural facts. Do not invent browser mechanics, values, controls or entity ids.
Return only semantic fields that materially add meaning. Omit empty, unknown, default or redundant fields. Do not explain ordinary controls unless an explanation is useful to the user. Do not echo option lists.
Useful fields include: meaning, semanticType, scope(local|global), interaction(user_input|information|action|navigation), relevantToGoal, required, question, explanation, caveats, examples, workflowRole(continue|back|commit|global|local), consequence(reversible|commit|financial|destructive|security), description, complete.
complete is meaningful primarily for workflow entities. For actions/navigation, classify consequence. Use reversible only for safe intermediate actions that can be automatically executed without submitting, committing, paying, deleting, authorizing or otherwise causing consequential effects. Mark final/committing actions as workflowRole=commit and consequence=commit (or a more specific consequential category).
Return strict JSON only as {entities:[{id,semantic:{...}}]}.`;

function compactLinks(links = []) {
  return arr(links).slice(0, 8).map((link) => ({
    id: String(link?.id || ''),
    relationship: String(link?.relationship || '')
  })).filter((link) => link.id && link.relationship);
}

function compactEntity(entity = {}) {
  const structural = entity.structural || {};
  const values = arr(structural.values);
  const safeStructural = {
    goal: entity.type === 'workflow' ? structural.goal || undefined : undefined,
    route: entity.type === 'page' || entity.type === 'modal' ? structural.route || undefined : undefined,
    controlType: structural.controlType || undefined,
    groupType: structural.groupType || undefined,
    required: structural.required === true ? true : undefined,
    disabled: structural.disabled === true ? true : undefined,
    readonly: structural.readonly === true ? true : undefined,
    checked: typeof structural.checked === 'boolean' ? structural.checked : undefined,
    hasValue: structural.value !== undefined && structural.value !== null && String(structural.value).trim() !== '' ? true : undefined,
    optionCount: values.length || undefined,
    optionSample: values.length ? values.slice(0, 4) : undefined
  };
  const links = compactLinks(entity.links);
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    structural: Object.fromEntries(Object.entries(safeStructural).filter(([, value]) => value !== undefined)),
    linkCount: arr(entity.links).length || undefined,
    links: links.length ? links : undefined
  };
}

function withWorkflow(entities = [], knownWorkflow = null) {
  const all = arr(entities);
  if (!knownWorkflow?.id || all.some((entity) => entity.id === knownWorkflow.id)) return all;
  return [knownWorkflow, ...all];
}

export function buildEntitySemanticPrompt({ userGoal = '', entities = [], pageId = '', knownWorkflow = null } = {}) {
  const modelEntities = withWorkflow(entities, knownWorkflow);
  const payload = {
    goal: text(userGoal, 300),
    pageId: String(pageId || ''),
    entities: modelEntities.map(compactEntity)
  };
  return `MODE web-entity-semantics-v1\nENTITY STRUCTURE:\n${JSON.stringify(payload)}\n\nTASK:\nReturn minimal semantic additions only for supplied entity ids. Treat workflow exactly like the other entities. Infer meaning, local/global scope, user-input/information/action/navigation role, goal relevance/requiredness, workflow role and action consequence. Add question/explanation/caveats/examples only when genuinely useful. optionSample is illustrative only; the complete option domain remains local to LeMap-Web and must not be echoed. Return {entities:[{id,semantic:{...}}]}.`;
}

function normalizeSemantic(raw = {}) {
  const semantic = {
    meaning: text(raw.meaning, 240),
    semanticType: text(raw.semanticType, 160),
    scope: SCOPES.has(raw.scope) ? raw.scope : undefined,
    interaction: INTERACTIONS.has(raw.interaction) ? raw.interaction : 'unknown',
    relevantToGoal: bool(raw.relevantToGoal, false),
    required: bool(raw.required, false),
    question: text(raw.question, 360),
    explanation: text(raw.explanation, 700),
    caveats: arr(raw.caveats).slice(0, 8).map((item) => text(item, 260)).filter(Boolean),
    examples: arr(raw.examples).slice(0, 8).map((item) => text(item, 180)).filter(Boolean),
    workflowRole: WORKFLOW_ROLES.has(raw.workflowRole) ? raw.workflowRole : 'unknown',
    consequence: CONSEQUENCES.has(raw.consequence) ? raw.consequence : 'unknown',
    description: text(raw.description, 700)
  };
  if (raw.complete !== undefined) semantic.complete = !!raw.complete;
  return semantic;
}

export function normalizeEntitySemanticResponse(raw = {}, knownEntities = []) {
  const known = new Set(arr(knownEntities).map((entity) => entity.id));
  return {
    entities: arr(raw.entities)
      .filter((item) => known.has(String(item?.id || '')))
      .map((item) => ({ id: String(item.id), semantic: normalizeSemantic(item.semantic || {}) }))
  };
}

export async function resolveEntitySemantics({ client, model, userGoal = '', entities = [], pageId = '', knownWorkflow = null } = {}) {
  const modelEntities = withWorkflow(entities, knownWorkflow);
  const userPrompt = buildEntitySemanticPrompt({ userGoal, entities: modelEntities, pageId });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeEntitySemanticResponse(response.parsed, modelEntities);
}
