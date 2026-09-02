import { callJsonModel } from '../semantic/modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function text(value, max = 700) { const s = String(value || '').trim().replace(/\s+/g, ' '); return s.length > max ? `${s.slice(0, max)}…` : s; }

const SYSTEM = `You are DataSong LeMap-Web's USER ANSWER INTERPRETER.
The browser structure and available choices are already known. Interpret the user's natural-language answer only against the supplied structural options and current semantic context.
Never invent an option or field id. Return strict compact JSON only.`;

export function buildUserQuestions({ graph = {}, state = {}, answeredGroupIds = new Set() } = {}) {
  const questions = [];
  for (const group of arr(graph.groups)) {
    if (answeredGroupIds.has(group.id)) continue;
    const options = arr(group.memberFieldIds).map((fieldId) => {
      const field = arr(graph.fields).find((candidate) => candidate.id === fieldId);
      const fieldState = state.fields?.[fieldId];
      return field && fieldState ? {
        fieldId,
        label: field.label,
        enabled: !!fieldState.enabled,
        visible: !!fieldState.visible,
        checked: !!fieldState.checked
      } : null;
    }).filter(Boolean);
    const actionable = options.filter((option) => option.enabled && option.visible);
    if (!actionable.length) continue;
    questions.push({
      groupId: group.id,
      label: group.label || actionable.map((option) => option.label).join(' / '),
      groupType: group.groupType,
      cardinality: group.groupType === 'radio' ? 'exactly_one' : 'one_or_more',
      options: actionable
    });
  }
  return questions;
}

export function buildUserAnswerPrompt({ userGoal = '', semanticEntity = {}, question = {}, userAnswer = '' } = {}) {
  const payload = {
    userGoal,
    currentEntity: semanticEntity,
    question: {
      groupId: question.groupId,
      label: question.label,
      cardinality: question.cardinality,
      options: arr(question.options).map((option) => ({ fieldId: option.fieldId, label: option.label }))
    },
    userAnswer
  };
  return `MODE web-user-answer-v1\n${JSON.stringify(payload)}\n\nTASK:\nMap the user's answer to only the supplied option field IDs. For exactly_one return one selectedFieldId. For one_or_more return all clearly selected options. Return JSON {selectedFieldIds,confidence,reason}.`;
}

export function normalizeUserAnswerResponse(raw = {}, question = {}) {
  const allowed = new Set(arr(question.options).map((option) => String(option.fieldId || '')).filter(Boolean));
  let selectedFieldIds = [...new Set(arr(raw.selectedFieldIds).map(String).filter((id) => allowed.has(id)))];
  if (question.cardinality === 'exactly_one') selectedFieldIds = selectedFieldIds.slice(0, 1);
  return {
    selectedFieldIds,
    confidence: clamp01(raw.confidence),
    reason: text(raw.reason, 420)
  };
}

export async function interpretUserAnswer({ client, model, userGoal, semanticEntity, question, userAnswer } = {}) {
  const prompt = buildUserAnswerPrompt({ userGoal, semanticEntity, question, userAnswer });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt: prompt });
  return normalizeUserAnswerResponse(response.parsed, question);
}
