import { callJsonModel } from '../semantic/modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 400) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const SYSTEM = `You are DataSong LeMap-Web's workflow continuation selector.
The browser agent has already filtered out structurally known past/back navigation, recurring global navigation, invisible controls and disabled controls.
You receive the user's goal, the ordered workflow pages visited so far, the current page, and only the remaining unresolved clickable candidates.
Choose the single candidate that best continues the current workflow toward the user's goal.
Do not classify candidates. Do not infer navigation roles, priorities, consequences, risk categories, or browser mechanics.
If none of the supplied candidates meaningfully continues the workflow, return an empty selectedEntityId.
Never invent an id. Return strict JSON only as {"selectedEntityId":"..."}.`;

function compactPage(page = null) {
  if (!page?.id) return undefined;
  return {
    id: String(page.id),
    name: text(page.name, 280),
    ...(page.semantic?.meaning ? { meaning: text(page.semantic.meaning, 280) } : {}),
    ...(page.semantic?.description ? { description: text(page.semantic.description, 360) } : {})
  };
}

function compactTrail(recentPageTrail = []) {
  return arr(recentPageTrail).map((page) => ({
    id: String(page?.id || ''),
    name: text(page?.name, 180)
  })).filter((page) => page.id);
}

function compactCandidate(entity = {}) {
  return {
    id: String(entity.id || ''),
    label: text(entity.name, 260),
    controlType: String(entity.structural?.controlType || '')
  };
}

export function buildNavigationChoicePrompt({ userGoal = '', candidates = [], pageContext = null, recentPageTrail = [] } = {}) {
  const payload = {
    goal: text(userGoal, 300),
    workflowPages: compactTrail(recentPageTrail),
    ...(compactPage(pageContext) ? { currentPage: compactPage(pageContext) } : {}),
    candidates: arr(candidates).map(compactCandidate)
  };
  return `MODE web-navigation-choice-v1\n${JSON.stringify(payload)}\n\nTASK:\nReturn only {"selectedEntityId":"..."} for the candidate that best continues the workflow toward the goal, or an empty string when none does.`;
}

export function normalizeNavigationChoiceResponse(raw = {}, candidates = []) {
  const known = new Set(arr(candidates).map((entity) => String(entity?.id || '')).filter(Boolean));
  const selectedEntityId = String(raw?.selectedEntityId || '');
  return { selectedEntityId: known.has(selectedEntityId) ? selectedEntityId : '' };
}

export async function chooseNavigationCandidate({ client, model, userGoal = '', candidates = [], pageContext = null, recentPageTrail = [] } = {}) {
  const options = arr(candidates).filter((entity) => entity?.id);
  if (!options.length) return null;
  if (options.length === 1) return options[0];

  const userPrompt = buildNavigationChoicePrompt({ userGoal, candidates: options, pageContext, recentPageTrail });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  const normalized = normalizeNavigationChoiceResponse(response.parsed, options);
  return options.find((entity) => entity.id === normalized.selectedEntityId) || null;
}
