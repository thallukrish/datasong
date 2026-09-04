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
LeMap-Web already discovered application structure deterministically. You receive entity ids, names, types, structural facts and relationships for the current rendered context plus the user's goal.
Every supplied item, including a workflow, is an entity. Add business/user-facing meaning only to those entity ids. Do not repeat structural facts. Do not invent browser mechanics, values, controls or entity ids.
For each supplied entity you may add: meaning, semanticType, scope(local|global), interaction(user_input|information|action|navigation|unknown), relevantToGoal, required, question, explanation, caveats, examples, workflowRole(continue|back|commit|global|local|unknown), consequence(reversible|commit|financial|destructive|security|unknown), description, complete.
Questions, explanations, examples, caveats, description and complete are optional. complete is meaningful primarily for workflow entities. For actions/navigation, classify consequence. Use reversible only for safe intermediate actions that can be automatically executed without submitting, committing, paying, deleting, authorizing or otherwise causing consequential effects. Mark final/committing actions as workflowRole=commit and consequence=commit (or a more specific consequential category).
Return strict JSON only as {entities:[{id,semantic:{...}}]}.`;

function compactEntity(entity = {}) {
  const structural = entity.structural || {};
  const safeStructural = {
    goal: entity.type === 'workflow' ? structural.goal || undefined : undefined,
    controlType: structural.controlType || undefined,
    groupType: structural.groupType || undefined,
    tag: structural.tag || undefined,
    role: structural.role || undefined,
    route: structural.route || undefined,
    visible: structural.visible,
    disabled: structural.disabled,
    required: structural.required,
    readonly: structural.readonly,
    checked: structural.checked,
    hasValue: structural.value !== undefined && structural.value !== null && String(structural.value).trim() !== '',
    values: arr(structural.values).slice(0, 60)
  };
  return {
    id: entity.id,
    name: entity.name,
    type: entity.type,
    structural: Object.fromEntries(Object.entries(safeStructural).filter(([, value]) => value !== undefined)),
    links: arr(entity.links).slice(0, 80)
  };
}

export function buildEntitySemanticPrompt({ userGoal = '', entities = [], pageId = '' } = {}) {
  const payload = {
    goal: text(userGoal, 300),
    pageId: String(pageId || ''),
    entities: arr(entities).map(compactEntity)
  };
  return `MODE web-entity-semantics-v1\nENTITY STRUCTURE:\n${JSON.stringify(payload)}\n\nTASK:\nReturn semantic additions only for supplied entity ids. Do not repeat structural fields. Treat workflow exactly like the other entities. Identify local/global scope, user-input/information/action/navigation role, goal relevance/requiredness, optional question/explanation/caveats/examples, workflow role, action consequence, and workflow description/completion where applicable. Return {entities:[{id,semantic:{...}}]}.`;
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

export async function resolveEntitySemantics({ client, model, userGoal = '', entities = [], pageId = '' } = {}) {
  const userPrompt = buildEntitySemanticPrompt({ userGoal, entities, pageId });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeEntitySemanticResponse(response.parsed, entities);
}
