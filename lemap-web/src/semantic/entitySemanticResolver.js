import { callJsonModel } from './modelCall.js';
import { redactModelText } from './modelPrivacy.js';
import {
  buildNavigationChoicePrompt,
  chooseNavigationCandidate,
  normalizeNavigationChoiceResponse
} from '../agent/navigationDecision.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 600, privacyEntities = []) {
  const s = redactModelText(value, privacyEntities).trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function bool(value, fallback = false) { return value === undefined ? fallback : !!value; }
function optionalBool(value) { return value === undefined ? undefined : !!value; }

const SCOPES = new Set(['local', 'global']);
const INTERACTIONS = new Set(['user_input', 'information', 'action', 'navigation', 'unknown']);
const SELECTION_RULES = new Set(['exactlyOne', 'anyOf', 'allOf', 'atLeastOne']);
const ACTION_CONTROL_TYPES = new Set(['button', 'link']);

const SYSTEM = `You are DataSong LeMap-Web's entity semantic interpreter.
LeMap-Web already owns the structural entity graph. You receive only unresolved non-navigation entities plus the user's goal and current page context.
The pageContext object, when present, is reference-only context. Do not return a semantic patch for pageContext unless that same page entity is explicitly included in entities.
For each supplied entity, return only its id and useful semantic additions. Never repeat structural facts, links, browser mechanics or user values. Never invent entity ids.
A group entity represents one user-facing choice independent of how its member controls are rendered. Member controls inside a supplied group are structural implementation details and are not separate semantic questions.
For every relevant group, you MUST return interaction=user_input, relevantToGoal, required, and a concise question. For groups, structural cardinality describes what the UI permits. Add selectionRule only when useful to express business meaning: exactlyOne, anyOf, allOf, or atLeastOne.
For relevant user-input entities, return interaction=user_input, relevantToGoal, required, and a concise question; add meaning, semanticType, scope, explanation only when needed, caveats only when needed, examples only when useful, and selectionRule when applicable.
For page/workflow/information entities, add only minimal useful meaning/description/relevance. complete is primarily for workflow entities.
Omit irrelevant entities entirely. Return strict JSON only as {entities:[{id,semantic:{...}}]}.`;

function compactEntity(entity = {}, privacyEntities = []) {
  const structural = entity.structural || {};
  const hint = entity.type === 'workflow'
    ? { goal: structural.goal ? text(structural.goal, 300, privacyEntities) : undefined }
    : entity.type === 'group'
      ? {
          cardinality: structural.cardinality || undefined,
          choices: arr(structural.values).slice(0, 8).map((value) => text(value, 100, privacyEntities)).filter(Boolean)
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
    name: text(entity.name, 360, privacyEntities),
    type: String(entity.type || 'unknown'),
    ...(Object.keys(structuralHint).length ? { structural: structuralHint } : {})
  };
}

function compactPageContext(page = null, privacyEntities = []) {
  if (!page?.id) return undefined;
  return {
    id: String(page.id),
    name: text(page.name, 360, privacyEntities),
    type: String(page.type || 'page'),
    ...(page.semantic?.meaning ? { meaning: text(page.semantic.meaning, 360, privacyEntities) } : {}),
    ...(page.semantic?.description ? { description: text(page.semantic.description, 500, privacyEntities) } : {})
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

function actionableControl(entity = {}) {
  return entity.type === 'ui_control' && ACTION_CONTROL_TYPES.has(String(entity.structural?.controlType || ''));
}

function executableActionableControl(entity = {}) {
  return actionableControl(entity)
    && entity.structural?.visible !== false
    && entity.structural?.disabled !== true;
}

export function partitionSemanticCandidates(entities = []) {
  const navigation = [];
  const entity = [];
  for (const candidate of arr(entities)) {
    if (actionableControl(candidate)) navigation.push(candidate);
    else entity.push(candidate);
  }
  return { navigation, entity };
}

export function entitiesNeedingSemantics(entities = []) {
  const all = arr(entities);
  const byId = new Map(all.map((entity) => [entity.id, entity]));
  return all.filter((entity) => {
    if (groupedChoiceMember(entity, byId)) return false;
    if (actionableControl(entity)) return executableActionableControl(entity);

    const semantic = entity?.semantic || {};
    if (!Object.keys(semantic).length) return true;
    if (entity?.type === 'workflow' && semantic.complete === undefined) return true;
    if (entity?.type === 'group' && semantic.relevantToGoal !== false) {
      if (semantic.interaction !== 'user_input') return true;
      if (semantic.required === undefined) return true;
      if (semantic.required === true && !semantic.question) return true;
    }
    if (entity?.type === 'ui_control' && semantic.interaction === 'user_input' && semantic.relevantToGoal === true) {
      if (semantic.required === undefined) return true;
      if (semantic.required === true && !semantic.question) return true;
    }
    return false;
  });
}

export function semanticCandidatesForCurrentState(entities = []) {
  return entitiesNeedingSemantics(entities);
}

export function buildEntitySemanticPrompt({ userGoal = '', entities = [], pageId = '', knownWorkflow = null, pageContext = null, privacyEntities = [] } = {}) {
  const modelEntities = withWorkflow(entities, knownWorkflow);
  const privacy = arr(privacyEntities).length ? privacyEntities : [...modelEntities, pageContext].filter(Boolean);
  const compactPage = compactPageContext(pageContext, privacy);
  const payload = {
    goal: text(userGoal, 300, privacy),
    pageId: String(pageId || ''),
    ...(compactPage ? { pageContext: compactPage } : {}),
    entities: modelEntities.map((entity) => compactEntity(entity, privacy))
  };
  return `MODE web-entity-semantics-v1\nUNRESOLVED ENTITIES:\n${JSON.stringify(payload)}\n\nTASK:\nReturn semantic additions only as {entities:[{id,semantic:{...}}]}. Omit irrelevant entities. pageContext is reference only unless the page itself also appears in entities. A relevant group is one user_input interaction and must include required plus a concise question; do not split its choices into separate questions. Use structural cardinality as the UI constraint and add selectionRule only for the business rule. Do not echo structure, links, browser mechanics or user values.`;
}

export function buildNavigationSemanticPrompt(args = {}) {
  return buildNavigationChoicePrompt({
    userGoal: args.userGoal,
    candidates: args.entities,
    pageContext: args.pageContext,
    recentPageTrail: args.recentPageTrail,
    privacyEntities: args.privacyEntities
  });
}

function normalizeSemantic(raw = {}) {
  const interaction = INTERACTIONS.has(raw.interaction) ? raw.interaction : 'unknown';
  const semantic = {
    meaning: String(raw.meaning ?? '').trim().replace(/\s+/g, ' ').slice(0, 240),
    semanticType: String(raw.semanticType ?? '').trim().replace(/\s+/g, ' ').slice(0, 160),
    scope: SCOPES.has(raw.scope) ? raw.scope : undefined,
    interaction,
    relevantToGoal: bool(raw.relevantToGoal, false),
    required: optionalBool(raw.required),
    question: String(raw.question ?? '').trim().replace(/\s+/g, ' ').slice(0, 360),
    explanation: String(raw.explanation ?? '').trim().replace(/\s+/g, ' ').slice(0, 700),
    caveats: arr(raw.caveats).slice(0, 8).map((item) => String(item ?? '').trim().replace(/\s+/g, ' ').slice(0, 260)).filter(Boolean),
    examples: arr(raw.examples).slice(0, 8).map((item) => String(item ?? '').trim().replace(/\s+/g, ' ').slice(0, 180)).filter(Boolean),
    selectionRule: SELECTION_RULES.has(raw.selectionRule) ? raw.selectionRule : undefined,
    description: String(raw.description ?? '').trim().replace(/\s+/g, ' ').slice(0, 700)
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

export function normalizeNavigationSemanticResponse(raw = {}, knownEntities = []) {
  const normalized = normalizeNavigationChoiceResponse(raw, knownEntities);
  if (!normalized.selectedEntityId) return { entities: [] };
  return {
    entities: [{
      id: normalized.selectedEntityId,
      semantic: {
        interaction: 'navigation',
        relevantToGoal: true,
        required: false,
        workflowRole: 'continue',
        navigationPriority: 100,
        consequence: 'reversible'
      }
    }]
  };
}

async function resolveGeneralSemantics({ client, model, userGoal = '', entities = [], pageId = '', pageContext = null, privacyEntities = [] } = {}) {
  if (!entities.length) return { entities: [] };
  const userPrompt = buildEntitySemanticPrompt({ userGoal, entities, pageId, pageContext, privacyEntities });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeEntitySemanticResponse(response.parsed, entities);
}

export async function resolveNavigationSemantics({ client, model, userGoal = '', entities = [], pageContext = null, recentPageTrail = [], privacyEntities = [] } = {}) {
  const actions = arr(entities).filter(executableActionableControl);
  const selected = await chooseNavigationCandidate({ client, model, userGoal, candidates: actions, pageContext, recentPageTrail, privacyEntities });
  if (!selected) return { entities: [] };
  return {
    entities: [{
      id: selected.id,
      semantic: {
        interaction: 'navigation',
        relevantToGoal: true,
        required: false,
        workflowRole: 'continue',
        navigationPriority: 100,
        consequence: 'reversible'
      }
    }]
  };
}

export async function resolveEntitySemantics({ client, model, userGoal = '', entities = [], pageId = '', knownWorkflow = null, pageContext = null, privacyEntities = [] } = {}) {
  const modelEntities = withWorkflow(entities, knownWorkflow);
  const split = partitionSemanticCandidates(modelEntities);
  if (!split.entity.length) return { entities: [] };
  return resolveGeneralSemantics({ client, model, userGoal, entities: split.entity, pageId, pageContext, privacyEntities });
}
