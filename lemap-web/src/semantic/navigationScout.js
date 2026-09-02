import { callJsonModel } from './modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 700) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

const ALLOWED_ROLES = new Set(['workflow_continuation', 'workflow_branch', 'related_entity', 'workflow_reverse', 'ancestor_workflow', 'workflow_exit', 'side_context', 'site_chrome', 'unknown']);

const SYSTEM = `You are DataSong LeMap-Web's GOAL-DIRECTED NAVIGATION SCOUT.
The current local entity has already been structurally explored and semantically resolved.
You receive the original user goal, the resolved entity, current workflow context, and outgoing button/link candidates.
Score each candidate for advancing the original user goal while preserving the active workflow context. A generally important portal destination can still be irrelevant to the user's goal.
Do not execute anything. Return strict compact JSON only.`;

export function buildNavigationPrompt({ userGoal = '', semanticEntity = {}, workflowContext = {}, candidates = [] } = {}) {
  const payload = {
    userGoal,
    currentEntity: semanticEntity,
    workflowContext,
    candidates: arr(candidates).map((candidate) => ({
      candidateId: candidate.id,
      label: candidate.label || '',
      kind: candidate.kind || '',
      href: candidate.href || '',
      enabled: candidate.enabled !== false,
      safety: candidate.safety || ''
    }))
  };
  return `MODE web-goal-navigation-v1\nCURRENT GOAL + RESOLVED ENTITY + OUTGOING CANDIDATES:\n${JSON.stringify(payload)}\n\nTASK:\nScore every candidate against the ORIGINAL USER GOAL and current workflow context. Return JSON {scores:[{candidateId,goalRelevance,continuity,forwardProgress,role,reason}]}. role must be workflow_continuation|workflow_branch|related_entity|workflow_reverse|ancestor_workflow|workflow_exit|side_context|site_chrome|unknown. Prefer candidates that safely advance the user goal; do not reward unrelated site chrome merely because it is globally important.`;
}

export function normalizeNavigationResponse(raw = {}, candidates = []) {
  const candidateIds = new Set(arr(candidates).map((candidate) => String(candidate.id || '')).filter(Boolean));
  const scores = arr(raw.scores).map((item) => ({
    candidateId: text(item?.candidateId, 200),
    goalRelevance: clamp01(item?.goalRelevance),
    continuity: clamp01(item?.continuity),
    forwardProgress: clamp01(item?.forwardProgress),
    role: ALLOWED_ROLES.has(item?.role) ? item.role : 'unknown',
    reason: text(item?.reason, 420)
  })).filter((item) => item.candidateId && candidateIds.has(item.candidateId));

  const seen = new Set(scores.map((score) => score.candidateId));
  for (const candidate of arr(candidates)) {
    const candidateId = String(candidate?.id || '');
    if (!candidateId || seen.has(candidateId)) continue;
    scores.push({ candidateId, goalRelevance: 0, continuity: 0, forwardProgress: 0, role: 'unknown', reason: 'Model did not score this candidate.' });
  }
  return scores.sort((a, b) => {
    const aTotal = a.goalRelevance * 0.5 + a.continuity * 0.3 + a.forwardProgress * 0.2;
    const bTotal = b.goalRelevance * 0.5 + b.continuity * 0.3 + b.forwardProgress * 0.2;
    return bTotal - aTotal || a.candidateId.localeCompare(b.candidateId);
  });
}

export async function scoreNavigationCandidates({ client, model, userGoal = '', semanticEntity, workflowContext = {}, candidates = [] } = {}) {
  const userPrompt = buildNavigationPrompt({ userGoal, semanticEntity, workflowContext, candidates });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeNavigationResponse(response.parsed, candidates);
}
