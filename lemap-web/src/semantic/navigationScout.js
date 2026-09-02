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

const ALLOWED_ROLES = new Set(['workflow_continuation', 'workflow_branch', 'related_entity', 'workflow_reverse', 'workflow_exit', 'side_context', 'unknown']);

const SYSTEM = `You are DataSong LeMap-Web's NAVIGATION CONTINUITY SCOUT.
The current local entity has already been structurally explored and semantically resolved.
You receive the resolved entity, current workflow context, and outgoing button/link candidates.
Score each candidate only for continuity with the current workflow arc. A generally important portal destination can still have very low continuity.
Do not execute anything. Return strict compact JSON only.`;

export function buildNavigationPrompt({ semanticEntity = {}, workflowContext = {}, candidates = [] } = {}) {
  const payload = {
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
  return `MODE web-navigation-scout-v1\nCURRENT RESOLVED ENTITY + OUTGOING CANDIDATES:\n${JSON.stringify(payload)}\n\nTASK:\nScore every supplied candidate for workflow continuity with the current entity and current arc. Return JSON {scores:[{candidateId,continuity,role,reason}]}. role must be workflow_continuation|workflow_branch|related_entity|workflow_reverse|workflow_exit|side_context|unknown. Higher continuity means a stronger next step in the same active workflow.`;
}

export function normalizeNavigationResponse(raw = {}, candidates = []) {
  const candidateIds = new Set(arr(candidates).map((candidate) => String(candidate.id || '')).filter(Boolean));
  const scores = arr(raw.scores).map((item) => ({
    candidateId: text(item?.candidateId, 200),
    continuity: clamp01(item?.continuity),
    role: ALLOWED_ROLES.has(item?.role) ? item.role : 'unknown',
    reason: text(item?.reason, 420)
  })).filter((item) => item.candidateId && candidateIds.has(item.candidateId));

  const seen = new Set(scores.map((score) => score.candidateId));
  for (const candidate of arr(candidates)) {
    const candidateId = String(candidate?.id || '');
    if (!candidateId || seen.has(candidateId)) continue;
    scores.push({ candidateId, continuity: 0, role: 'unknown', reason: 'Model did not score this candidate.' });
  }
  return scores.sort((a, b) => b.continuity - a.continuity || a.candidateId.localeCompare(b.candidateId));
}

export async function scoreNavigationCandidates({ client, model, semanticEntity, workflowContext = {}, candidates = [] } = {}) {
  const userPrompt = buildNavigationPrompt({ semanticEntity, workflowContext, candidates });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeNavigationResponse(response.parsed, candidates);
}
