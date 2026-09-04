import { callJsonModel } from './modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 600) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function bool(value, fallback = false) { return value === undefined ? fallback : !!value; }

const SCOPES = new Set(['local', 'global']);
const INTERACTIONS = new Set(['user_input', 'information', 'action', 'navigation', 'unknown']);

const SYSTEM = `You are DataSong LeMap-Web's entity semantic interpreter.
LeMap-Web already discovered the application structure deterministically. You receive entity ids, names, types, structural facts and relationships for the current rendered context plus the user's goal.
Add business/user-facing meaning only. Do not repeat structural facts. Do not invent browser mechanics, values, controls or entity ids.
For each relevant entity you may add: meaning, semanticType, scope(local|global), interaction(user_input|information|action|navigation|unknown), relevantToGoal, required, question, explanation, caveats, examples, workflowRole.
Questions/explanations/examples/caveats are optional. A workflow role may describe how an action/page participates in advancing the goal.
Return strict JSON only.`;

function compactEntity(entity = {}) {
  const structural = entity.structural || {};
  const safeStructural = {
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

export function buildEntitySemanticPrompt({ userGoal = '', entities = [], pageId = '', knownWorkflow = null } = {}) {
  const payload = {
    goal: text(userGoal, 300),
    pageId: String(pageId || ''),
    entities: arr(entities).map(compactEntity),
    workflow: knownWorkflow || undefined
  };
  return `MODE web-entity-semantics-v1\nENTITY STRUCTURE:\n${JSON.stringify(payload)}\n\nTASK:\nReturn semantic additions only for supplied entity ids. Do not repeat structural fields. Identify which entities are local/global, user input/information/action/navigation, which are relevant/required for the goal, and any useful question, explanation, caveats, examples or workflow role. Return {entities:[{id,semantic:{...}}], workflow?:{name,description,complete}}.`;
}

function normalizeSemantic(raw = {}) {
  return {
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
    workflowRole: text(raw.workflowRole, 180)
  };
}

export function normalizeEntitySemanticResponse(raw = {}, knownEntities = []) {
  const known = new Set(arr(knownEntities).map((entity) => entity.id));
  const entities = arr(raw.entities)
    .filter((item) => known.has(String(item?.id || '')))
    .map((item) => ({ id: String(item.id), semantic: normalizeSemantic(item.semantic || {}) }));
  const workflow = raw.workflow && typeof raw.workflow === 'object' ? {
    name: text(raw.workflow.name, 240),
    description: text(raw.workflow.description, 700),
    complete: !!raw.workflow.complete
  } : null;
  return { entities, workflow };
}

export async function resolveEntitySemantics({ client, model, userGoal = '', entities = [], pageId = '', knownWorkflow = null } = {}) {
  const userPrompt = buildEntitySemanticPrompt({ userGoal, entities, pageId, knownWorkflow });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeEntitySemanticResponse(response.parsed, entities);
}
