import { callJsonModel } from '../semantic/modelCall.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clamp01(value) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
function text(value, max = 700) { const s = String(value || '').trim().replace(/\s+/g, ' '); return s.length > max ? `${s.slice(0, max)}…` : s; }

const SYSTEM = `You are DataSong LeMap-Web's CHOICE ANSWER INTERPRETER.
The browser structure and available choices are already known. Interpret the user's natural-language choice only against the supplied structural options and compact semantic context.
Never invent an option, field id, or factual value. You never receive free-form personal field values. Return strict compact JSON only.`;

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
  if (question.answerKind !== 'choice') throw new Error('Free-form value answers must not be sent to the model');
  const payload = {
    userGoal: text(userGoal, 220),
    currentEntity: compactSemanticForQuestion(semanticEntity, question),
    question: {
      questionId: question.questionId,
      answerKind: 'choice',
      groupId: question.groupId || '',
      label: text(question.label, 280),
      cardinality: question.cardinality,
      options: arr(question.options).slice(0, 30).map((option) => ({ fieldId: option.fieldId || '', value: option.value ?? '', label: text(option.label, 160) }))
    },
    userAnswer: text(userAnswer, 500)
  };
  return `MODE web-user-choice-v1\n${JSON.stringify(payload)}\n\nTASK:\nMap the user's choice only to supplied option field IDs. Return JSON {selectedFieldIds,confidence,reason}.`;
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
    reason: text(raw.reason, 420),
    local: !!raw.local
  };
}

function localValueInterpretation(userAnswer = '') {
  const value = String(userAnswer ?? '').trim();
  return {
    selectedFieldIds: [],
    value,
    confidence: value ? 1 : 0,
    reason: value ? 'value accepted locally' : 'no value supplied',
    local: true
  };
}

function localChoiceInterpretation(question = {}, userAnswer = '') {
  const options = arr(question.options);
  const raw = String(userAnswer ?? '').trim();
  if (!raw || !options.length) return null;

  const numericParts = raw.split(/[\s,]+/).filter(Boolean);
  if (numericParts.every((part) => /^\d+$/.test(part))) {
    const indexes = [...new Set(numericParts.map(Number))];
    const selected = indexes.map((index) => options[index - 1]).filter(Boolean);
    if (selected.length === indexes.length && (question.cardinality !== 'exactly_one' || selected.length === 1)) {
      return {
        selectedFieldIds: selected.map((option) => String(option.fieldId || '')).filter(Boolean),
        value: '',
        confidence: 1,
        reason: 'choice matched locally by option number',
        local: true
      };
    }
  }

  const normalized = raw.toLocaleLowerCase();
  const exact = options.filter((option) => [option.label, option.value, option.fieldId]
    .some((candidate) => String(candidate ?? '').trim().toLocaleLowerCase() === normalized));
  if (exact.length === 1) {
    return {
      selectedFieldIds: [String(exact[0].fieldId || '')].filter(Boolean),
      value: '',
      confidence: 1,
      reason: 'choice matched locally by exact option',
      local: true
    };
  }
  return null;
}

export async function interpretUserAnswer({ client, model, userGoal, semanticEntity, question, userAnswer } = {}) {
  if (question.answerKind === 'value') return localValueInterpretation(userAnswer);

  const localChoice = localChoiceInterpretation(question, userAnswer);
  if (localChoice) return localChoice;

  const prompt = buildUserAnswerPrompt({ userGoal, semanticEntity, question, userAnswer });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt: prompt });
  return normalizeUserAnswerResponse(response.parsed, question);
}
