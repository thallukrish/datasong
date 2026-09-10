import { callJsonModel } from '../semantic/modelCall.js';
import { redactModelText } from '../semantic/modelPrivacy.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 320, privacyEntities = []) {
  const safe = redactModelText(value, privacyEntities).trim().replace(/\s+/g, ' ');
  return safe.length > max ? `${safe.slice(0, max)}…` : safe;
}

const SYSTEM = `You are DataSong LeMap-Web's learning value proposer.
The traversal engine has already selected exactly one user input. Your only job is to propose a value for that input so the workflow can be explored.
Do not classify the input, change semantics, choose navigation, or invent entity ids.
For finite choices, answer with the supplied key or comma-separated keys. For free-form inputs, answer with one plausible synthetic value suitable for exploration.
Return strict JSON only as {"answer":"..."}.`;

export function buildLearningValuePrompt({ userGoal = '', entity = {}, question = {}, privacyEntities = [] } = {}) {
  const choices = arr(question.options)
    .slice(0, 24)
    .map((value, index) => ({ key: String(index + 1), label: text(value, 140, privacyEntities) }));
  const payload = {
    goal: text(userGoal, 300, privacyEntities),
    entityId: String(entity.id || question.entityId || ''),
    question: text(question.label || entity.name || '', 360, privacyEntities),
    ...(choices.length ? { choices } : {}),
    ...(question.multiple ? { multiple: true, selectionRule: String(question.selectionRule || 'anyOf') } : {})
  };
  return `MODE web-learning-value-v1\n${JSON.stringify(payload)}\n\nTASK:\nReturn only {"answer":"..."}.`;
}

export function normalizeLearningValueResponse(raw = {}) {
  if (raw?.answer === undefined || raw?.answer === null) return { answer: '' };
  return { answer: String(raw.answer).trim().slice(0, 300) };
}

export async function resolveLearningValue({ client, model, userGoal = '', entity = {}, question = {}, privacyEntities = [] } = {}) {
  const userPrompt = buildLearningValuePrompt({ userGoal, entity, question, privacyEntities });
  const response = await callJsonModel({ client, model, systemPrompt: SYSTEM, userPrompt });
  return normalizeLearningValueResponse(response.parsed);
}
