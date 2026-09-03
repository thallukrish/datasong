import { callJsonModel } from '../semantic/modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function text(value, max = 700) { const s = String(value || '').trim().replace(/\s+/g, ' '); return s.length > max ? `${s.slice(0, max)}…` : s; }

const SYSTEM = `You are DataSong LeMap-Web's USER ANSWER INTERPRETER.
The browser structure and available choices are already known. Interpret the user's natural-language answer only against the supplied structural question and compact semantic context.
Never invent an option, field id, or factual value. Return strict compact JSON only.`;

export function buildUserQuestions({ graph = {}, state = {}, answeredQuestionIds = new Set(), answeredGroupIds = null } = {}) {
  const answered = answeredQuestionIds instanceof Set ? answeredQuestionIds : (answeredGroupIds instanceof Set ? answeredGroupIds : new Set());
  const questions = [];

  for (const group of arr(graph.groups)) {
    const questionId = `group:${group.id}`;
    if (answered.has(questionId) || answered.has(group.id)) continue;
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
      questionId,
      answerKind: 'choice',
      groupId: group.id,
      label: group.label || actionable.map((option) => option.label).join(' / '),
      groupType: group.groupType,
      cardinality: group.groupType === 'radio' ? 'exactly_one' : 'one_or_more',
      options: actionable
    });
  }

  const grouped = new Set(arr(graph.groups).flatMap((group) => arr(group.memberFieldIds)));
  for (const field of arr(graph.fields)) {
    if (grouped.has(field.id) || field.parentGroupId) continue;
    if (!['text', 'number', 'date', 'select', 'autocomplete'].includes(field.type)) continue;
    const questionId = `field:${field.id}`;
    if (answered.has(questionId)) continue;
    const fieldState = state.fields?.[field.id];
    if (!fieldState?.enabled || !fieldState?.visible) continue;
    const current = fieldState.value;
    if (current !== null && current !== undefined && String(current).trim() !== '') continue;
    questions.push({
      questionId,
      answerKind: 'value',
      fieldId: field.id,
      label: field.label || field.name || 'Please provide a value',
      inputType: field.type,
      cardinality: 'single_value',
      options: arr(field.valueDomain).map((value) => ({ value: String(value), label: String(value) }))
    });
  }

  return questions;
}

function compactSemanticForQuestion(semanticEntity = {}, question = {}) {
  const semanticKey = String(question.questionId || '').startsWith('interaction:') ? String(question.questionId).slice('interaction:'.length) : '';
  const interaction = arr(semanticEntity.interactions).find((item) => item.semanticKey === semanticKey);
  return {
    semanticName: text(semanticEntity.semanticName, 180),
    description: text(semanticEntity.description, 360),
    interaction: interaction ? {
      semanticKey: text(interaction.semanticKey, 140),
      semanticName: text(interaction.semanticName, 160),
      explanation: text(interaction.explanation, 300),
      question: text(interaction.question, 260)
    } : null
  };
}

export function buildUserAnswerPrompt({ userGoal = '', semanticEntity = {}, question = {}, userAnswer = '' } = {}) {
  const payload = {
    userGoal: text(userGoal, 220),
    currentEntity: compactSemanticForQuestion(semanticEntity, question),
    question: {
      questionId: question.questionId,
      answerKind: question.answerKind,
      groupId: question.groupId || '',
      fieldId: question.fieldId || '',
      inputType: question.inputType || '',
      label: text(question.label, 280),
      cardinality: question.cardinality,
      options: arr(question.options).slice(0, 30).map((option) => ({ fieldId: option.fieldId || '', value: option.value ?? '', label: text(option.label, 160) }))
    },
    userAnswer
  };
  return `MODE web-user-answer-v1\n${JSON.stringify(payload)}\n\nTASK:\nIf answerKind=choice, map the user's answer only to supplied option field IDs. If answerKind=value, preserve only the concrete value the user supplied, normalized minimally for the input type; do not infer missing facts. Return JSON {selectedFieldIds,value,confidence,reason}.`;
}

export function normalizeUserAnswerResponse(raw = {}, question = {}) {
  const allowed = new Set(arr(question.options).map((option) => String(option.fieldId || '')).filter(Boolean));
  let selectedFieldIds = [...new Set(arr(raw.selectedFieldIds).map(String).filter((id) => allowed.has(id)))];
  if (question.cardinality === 'exactly_one') selectedFieldIds = selectedFieldIds.slice(0, 1);
  const value = question.answerKind === 'value' ? text(raw.value, 1000) : '';
  return {
    selectedFieldIds,
    value,
    confidence: clamp01(raw.confidence),
    reason: text(raw.reason, 420)
  };
}

export async function interpretUserAnswer({ client, model, userGoal, semanticEntity, question, userAnswer } = {}) {
  const prompt = buildUserAnswerPrompt({ userGoal, semanticEntity, question, userAnswer });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt: prompt });
  return normalizeUserAnswerResponse(response.parsed, question);
}
