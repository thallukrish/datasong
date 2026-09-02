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

const DECISIONS = new Set(['navigate', 'ask_user', 'explore_more', 'stop']);

const SYSTEM = `You are DataSong LeMap-Web's INFORMATION-NEED PLANNER.
LeMap-Web is a lazy goal-directed navigator. The current rendered context has already been structurally inspected and semantically interpreted.
Your job is NOT to ask for every empty field. Decide whether the agent already knows enough to navigate toward the original user goal, whether safe local exploration is still needed, or whether a genuinely user-specific/business fact must be requested from the user.
Use only supplied candidate question IDs. Never invent browser state or user facts. Return strict compact JSON only.`;

export function buildInformationNeedPrompt({ userGoal = '', semanticContext = {}, workflowContext = {}, candidateQuestions = [], navigationCandidates = [] } = {}) {
  const payload = {
    userGoal,
    semanticContext,
    workflowContext,
    candidateQuestions: arr(candidateQuestions).map((question) => ({
      questionId: question.questionId,
      answerKind: question.answerKind,
      label: question.label,
      inputType: question.inputType || '',
      cardinality: question.cardinality || '',
      options: arr(question.options).map((option) => ({
        fieldId: option.fieldId || '',
        value: option.value ?? '',
        label: option.label || ''
      }))
    })),
    navigationCandidates: arr(navigationCandidates).map((candidate) => ({
      candidateId: candidate.id,
      label: candidate.label || '',
      kind: candidate.kind || '',
      enabled: candidate.enabled !== false,
      safety: candidate.safety || ''
    }))
  };
  return `MODE web-information-need-v1\nCURRENT GOAL + SEMANTIC CONTEXT:\n${JSON.stringify(payload)}\n\nTASK:\nChoose exactly one decision: navigate | ask_user | explore_more | stop.\n- navigate: enough is known to score/follow a safe outgoing transition now; do not ask merely because an input is empty.\n- ask_user: progress is blocked by genuinely user-specific/business information. Return only the minimal supplied questionIds needed now, in order.\n- explore_more: safe local structural/behavioral exploration could resolve the uncertainty without asking the user.\n- stop: the goal cannot be safely advanced from supplied evidence.\nReturn JSON {decision,questionIds,reason,confidence}.`;
}

export function normalizeInformationNeedResponse(raw = {}, candidateQuestions = []) {
  const decision = DECISIONS.has(raw.decision) ? raw.decision : 'stop';
  const allowed = new Set(arr(candidateQuestions).map((question) => String(question.questionId || '')).filter(Boolean));
  const questionIds = decision === 'ask_user'
    ? [...new Set(arr(raw.questionIds).map(String).filter((id) => allowed.has(id)))]
    : [];
  return {
    decision: decision === 'ask_user' && questionIds.length === 0 ? 'stop' : decision,
    questionIds,
    reason: text(raw.reason, 520),
    confidence: clamp01(raw.confidence)
  };
}

export async function planInformationNeed({ client, model, userGoal, semanticContext, workflowContext = {}, candidateQuestions = [], navigationCandidates = [] } = {}) {
  const userPrompt = buildInformationNeedPrompt({ userGoal, semanticContext, workflowContext, candidateQuestions, navigationCandidates });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeInformationNeedResponse(response.parsed, candidateQuestions);
}
