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
const ALLOWED_CONSEQUENCES = new Set(['reversible', 'commit', 'financial', 'destructive', 'security', 'unknown']);

const SYSTEM = `You are DataSong LeMap-Web's GOAL-DIRECTED NAVIGATION SCOUT.
The current local entity has already been structurally explored and semantically resolved.
You receive the original user goal, a compact resolved entity summary, current workflow context, and outgoing button/link candidates.
Score each candidate for advancing the original user goal while preserving the active workflow context.
Also classify the consequence of executing each candidate from the supplied semantics: reversible ordinary navigation/workflow progress, external commit, financial commitment, destructive mutation, security-sensitive action, or unknown.
Do not execute anything. Return strict compact JSON only.`;

function compactEntity(semanticEntity = {}) {
  return {
    semanticName: text(semanticEntity.semanticName, 180),
    description: text(semanticEntity.description, 420),
    localCompletion: text(semanticEntity.localCompletion, 260),
    subEntities: arr(semanticEntity.subEntities).slice(0, 8).map((item) => text(item?.semanticName, 160)).filter(Boolean),
    relationships: arr(semanticEntity.relationships).slice(0, 8).map((item) => ({ kind: text(item?.kind, 100), description: text(item?.description, 220) })),
    actions: arr(semanticEntity.actions).slice(0, 10).map((item) => ({ semanticName: text(item?.semanticName, 160), description: text(item?.description, 220) }))
  };
}

export function buildNavigationPrompt({ userGoal = '', semanticEntity = {}, workflowContext = {}, candidates = [] } = {}) {
  const payload = {
    userGoal: text(userGoal, 240),
    currentEntity: compactEntity(semanticEntity),
    workflowContext: {
      currentEntity: text(workflowContext.currentEntity, 180),
      semanticPath: arr(workflowContext.semanticPath).slice(-6).map((item) => text(item, 160)),
      knownOutgoing: arr(workflowContext.knownOutgoing).slice(0, 8),
      traversed: arr(workflowContext.traversed).slice(-6)
    },
    candidates: arr(candidates).slice(0, 30).map((candidate) => ({
      candidateId: candidate.id,
      label: candidate.label || '',
      kind: candidate.kind || '',
      href: candidate.href || '',
      enabled: candidate.enabled !== false
    }))
  };
  return `MODE web-goal-navigation-v1\nCURRENT GOAL + RESOLVED ENTITY + OUTGOING CANDIDATES:\n${JSON.stringify(payload)}\n\nTASK:\nScore every candidate against the ORIGINAL USER GOAL and current workflow context. Return JSON {scores:[{candidateId,goalRelevance,continuity,forwardProgress,role,consequence,reason}]}. role must be workflow_continuation|workflow_branch|related_entity|workflow_reverse|ancestor_workflow|workflow_exit|side_context|site_chrome|unknown. consequence must be reversible|commit|financial|destructive|security|unknown. Use reversible only for ordinary navigation or workflow progress that does not itself create an external commitment, payment, destructive mutation, or security-sensitive effect. Prefer candidates that safely advance the user goal; do not reward unrelated site chrome merely because it is globally important.`;
}

export function normalizeNavigationResponse(raw = {}, candidates = []) {
  const candidateIds = new Set(arr(candidates).map((candidate) => String(candidate.id || '')).filter(Boolean));
  const scores = arr(raw.scores).map((item) => ({
    candidateId: text(item?.candidateId, 200),
    goalRelevance: clamp01(item?.goalRelevance),
    continuity: clamp01(item?.continuity),
    forwardProgress: clamp01(item?.forwardProgress),
    role: ALLOWED_ROLES.has(item?.role) ? item.role : 'unknown',
    consequence: ALLOWED_CONSEQUENCES.has(item?.consequence) ? item.consequence : 'unknown',
    reason: text(item?.reason, 420)
  })).filter((item) => item.candidateId && candidateIds.has(item.candidateId));

  const seen = new Set(scores.map((score) => score.candidateId));
  for (const candidate of arr(candidates)) {
    const candidateId = String(candidate?.id || '');
    if (!candidateId || seen.has(candidateId)) continue;
    scores.push({ candidateId, goalRelevance: 0, continuity: 0, forwardProgress: 0, role: 'unknown', consequence: 'unknown', reason: 'Model did not score this candidate.' });
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
