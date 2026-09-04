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

const DECISIONS = new Set(['navigate', 'ask_user', 'stop']);

const SYSTEM = `You are DataSong LeMap-Web's INFORMATION-NEED PLANNER.
LeMap-Web is a lazy goal-directed navigator. The current rendered context has already been structurally inspected and semantically interpreted, and structural novelty has already been handled before you are called.
Your job is NOT to ask for every empty field. Decide whether the agent already knows enough to navigate toward the original user goal, whether a genuinely user-specific/business fact must be requested, or whether execution should stop.
Only interactions represented by supplied candidate question IDs are currently unresolved and goal-relevant. Resolved/optional interaction semantics are deliberately omitted. If candidateQuestions is empty, do not choose ask_user.
When choosing stop, explicitly distinguish goal completion from inability to advance using goalComplete. Set goalComplete=true only when the supplied semantic/workflow evidence indicates the ORIGINAL USER GOAL has been completed. Otherwise false.
Do not request speculative exploration; real execution and structural-delta handling happen outside this planner.
Use only supplied candidate question IDs. Never invent browser state or user facts. Return strict compact JSON only.`;

function compactSemanticContext(semanticContext = {}, candidateQuestions = []) {
  const wantedKeys = new Set(arr(candidateQuestions)
    .map((question) => String(question.questionId || ''))
    .filter((id) => id.startsWith('interaction:'))
    .map((id) => id.slice('interaction:'.length)));
  return {
    semanticName: text(semanticContext.semanticName, 180),
    description: text(semanticContext.description, 420),
    localCompletion: text(semanticContext.localCompletion, 300),
    subEntities: arr(semanticContext.subEntities).slice(0, 8).map((item) => ({ semanticName: text(item?.semanticName, 160), description: text(item?.description, 220) })),
    relationships: arr(semanticContext.relationships).slice(0, 8).map((item) => ({ kind: text(item?.kind, 100), description: text(item?.description, 240) })),
    interactions: arr(semanticContext.interactions)
      .filter((item) => wantedKeys.has(String(item?.semanticKey || '')))
      .slice(0, 8)
      .map((item) => ({
        semanticKey: text(item?.semanticKey, 140),
        semanticName: text(item?.semanticName, 160),
        explanation: text(item?.explanation, 260),
        question: text(item?.question, 220),
        valueScope: text(item?.valueScope, 60),
        goalRelevance: clamp01(item?.goalRelevance),
        priority: Number.isFinite(Number(item?.priority)) ? Number(item.priority) : 100,
        requiredForGoal: item?.requiredForGoal !== false
      }))
  };
}

export function buildInformationNeedPrompt({ userGoal = '', semanticContext = {}, workflowContext = {}, candidateQuestions = [], navigationCandidates = [] } = {}) {
  const payload = {
    userGoal: text(userGoal, 240),
    semanticContext: compactSemanticContext(semanticContext, candidateQuestions),
    workflowContext: {
      currentEntity: text(workflowContext.currentEntity, 180),
      semanticPath: arr(workflowContext.semanticPath).slice(-5).map((item) => text(item, 160)),
      knownOutgoing: arr(workflowContext.knownOutgoing).slice(0, 8),
      userAnswers: arr(workflowContext.userAnswers).slice(-6).map((item) => ({ question: text(item?.question, 180), selectedLabels: arr(item?.selectedLabels).slice(0, 4), valueProvided: !!item?.valueProvided }))
    },
    candidateQuestions: arr(candidateQuestions).map((question) => ({
      questionId: question.questionId,
      answerKind: question.answerKind,
      label: text(question.label, 240),
      information: text(question.information, 280),
      inputType: question.inputType || '',
      cardinality: question.cardinality || '',
      options: arr(question.options).slice(0, 30).map((option) => ({ fieldId: option.fieldId || '', value: option.value ?? '', label: text(option.label, 160) }))
    })),
    navigationCandidates: arr(navigationCandidates).slice(0, 20).map((candidate) => ({
      candidateId: candidate.id,
      label: candidate.label || '',
      kind: candidate.kind || '',
      enabled: candidate.enabled !== false
    }))
  };
  return `MODE web-information-need-v2\nCURRENT GOAL + COMPACT SEMANTIC CONTEXT:\n${JSON.stringify(payload)}\n\nTASK:\nChoose exactly one decision: navigate | ask_user | stop.\n- navigate: enough is known to score/follow a safe outgoing transition now.\n- ask_user: progress is blocked by genuinely user-specific/business information represented by one or more supplied candidateQuestions. Return only the minimal supplied questionIds needed now, in order. Never choose ask_user when candidateQuestions is empty.\n- stop: no further interaction/navigation should be attempted from the supplied evidence. Set goalComplete=true only if the ORIGINAL USER GOAL is semantically completed; otherwise false.\nReturn JSON {decision,questionIds,reason,confidence,goalComplete}.`;
}

export function normalizeInformationNeedResponse(raw = {}, candidateQuestions = []) {
  const decision = DECISIONS.has(raw.decision) ? raw.decision : 'stop';
  const allowed = new Set(arr(candidateQuestions).map((question) => String(question.questionId || '')).filter(Boolean));
  const questionIds = decision === 'ask_user'
    ? [...new Set(arr(raw.questionIds).map(String).filter((id) => allowed.has(id)))]
    : [];
  const normalizedDecision = decision === 'ask_user' && questionIds.length === 0 ? 'stop' : decision;
  return {
    decision: normalizedDecision,
    questionIds,
    reason: text(raw.reason, 520),
    confidence: clamp01(raw.confidence),
    goalComplete: normalizedDecision === 'stop' && raw.goalComplete === true
  };
}

export async function planInformationNeed({ client, model, userGoal, semanticContext, workflowContext = {}, candidateQuestions = [], navigationCandidates = [] } = {}) {
  const userPrompt = buildInformationNeedPrompt({ userGoal, semanticContext, workflowContext, candidateQuestions, navigationCandidates });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeInformationNeedResponse(response.parsed, candidateQuestions);
}
