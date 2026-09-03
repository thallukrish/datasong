import { findApplicableFact } from './instanceMemory.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function nonEmpty(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }
function norm(value = '') { return String(value).trim().toLowerCase().replace(/\s+/g, ' '); }

export function interactionFields(graph = {}, interaction = {}) {
  const ids = new Set(arr(interaction.structuralFieldIds).map(String));
  for (const group of arr(graph.groups)) {
    if (!['radio', 'checkbox'].includes(String(group?.groupType || ''))) continue;
    const members = arr(group.memberFieldIds).map(String);
    if (members.some((fieldId) => ids.has(fieldId))) members.forEach((fieldId) => ids.add(fieldId));
  }
  return arr(graph.fields).filter((field) => ids.has(String(field.id)));
}

export function interactionExecutable(graph = {}, state = {}, interaction = {}) {
  const fields = interactionFields(graph, interaction);
  if (!fields.length) return false;
  return fields.some((field) => {
    const current = state.fields?.[field.id];
    return !!current?.visible && !!current?.enabled && !current?.readonly;
  });
}

export function currentInteractionValue(graph = {}, state = {}, interaction = {}) {
  const fields = interactionFields(graph, interaction);
  if (!fields.length) return { value: '', optionLabel: '' };
  if (fields.length > 1 || fields.some((field) => ['radio', 'checkbox'].includes(field.type))) {
    const selected = fields.filter((field) => state.fields?.[field.id]?.checked === true);
    const labels = selected.map((field) => field.label || field.value).filter(Boolean);
    const values = selected.map((field) => field.value || field.label).filter(Boolean);
    return { value: values.join('|'), optionLabel: labels.join(', ') };
  }
  const field = fields[0];
  const value = state.fields?.[field.id]?.value;
  return { value: nonEmpty(value) ? String(value) : '', optionLabel: nonEmpty(value) ? String(value) : '' };
}

export function scopeKeyForInteraction(interaction = {}, scopeKeys = {}, workflowKey = '') {
  const scope = interaction.valueScope || 'filing_instance';
  if (scope === 'global') return 'global';
  if (scope === 'taxpayer') return scopeKeys.taxpayer || '';
  if (scope === 'workflow') return scopeKeys.workflow || workflowKey;
  return scopeKeys[scope] || '';
}

export function classifyInteractionItems({ graph = {}, state = {}, semanticEntity = {}, instanceMemory = null, workflowKey = '', scopeKeys = {} } = {}) {
  return arr(semanticEntity.interactions).map((interaction) => {
    const current = currentInteractionValue(graph, state, interaction);
    if (current.optionLabel) return { ...interaction, status: 'prefilled', displayValue: current.optionLabel, currentValue: current.value, source: 'prefill', rememberedFact: null };

    const reusePolicy = interaction.reusePolicy || 'never';
    const scope = interaction.valueScope || 'filing_instance';
    const scopeKey = scopeKeyForInteraction(interaction, scopeKeys, workflowKey);
    const rememberedFact = reusePolicy !== 'never' && scopeKey
      ? findApplicableFact(instanceMemory, { semanticKey: interaction.semanticKey, workflowKey, scope, scopeKey })
      : null;
    if (rememberedFact) {
      const executable = interactionExecutable(graph, state, interaction);
      return {
        ...interaction,
        status: executable ? 'remembered' : 'blocked',
        displayValue: rememberedFact.optionLabel || (nonEmpty(rememberedFact.value) ? String(rememberedFact.value) : ''),
        currentValue: '',
        source: 'remembered',
        rememberedFact
      };
    }
    return { ...interaction, status: 'missing', displayValue: '', currentValue: '', source: 'user', rememberedFact: null };
  });
}

export function buildQuestionFromInteraction({ graph = {}, interaction = {} } = {}) {
  const fields = interactionFields(graph, interaction);
  if (!fields.length) return null;
  const groupedChoice = fields.length > 1 || fields.some((field) => ['radio', 'checkbox'].includes(field.type));
  if (groupedChoice) {
    return {
      questionId: `interaction:${interaction.semanticKey}`,
      answerKind: 'choice',
      groupId: fields[0]?.parentGroupId || '',
      label: interaction.question || interaction.explanation || interaction.semanticName || fields.map((field) => field.label).join(' / '),
      information: interaction.explanation || '',
      examples: arr(interaction.examples),
      cardinality: fields.every((field) => field.type === 'radio') ? 'exactly_one' : 'one_or_more',
      options: fields.map((field) => ({ fieldId: field.id, label: field.label }))
    };
  }
  const field = fields[0];
  return {
    questionId: `interaction:${interaction.semanticKey}`,
    answerKind: 'value',
    fieldId: field.id,
    label: interaction.question || interaction.explanation || field.label,
    information: interaction.explanation || '',
    examples: arr(interaction.examples),
    inputType: field.type,
    cardinality: 'single_value',
    options: arr(field.valueDomain).map((value) => ({ value: String(value), label: String(value) }))
  };
}

export function interpretationFromRemembered({ graph = {}, interaction = {}, fact = null } = {}) {
  if (!fact) return null;
  const fields = interactionFields(graph, interaction);
  const choiceFields = fields.filter((field) => ['radio', 'checkbox'].includes(field.type));
  if (choiceFields.length) {
    const wanted = new Set(String(fact.optionLabel || fact.value || '')
      .split(/\s*[,|]\s*/)
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean));
    const selected = choiceFields.filter((field) => [field.label, field.value].some((value) => wanted.has(String(value || '').trim().toLowerCase())));
    if (!selected.length) return null;
    return { selectedFieldIds: selected.map((field) => field.id), value: '', confidence: 1, reason: 'reused stored workflow fact' };
  }
  return { selectedFieldIds: [], value: fact.value ?? fact.optionLabel ?? '', confidence: 1, reason: 'reused stored workflow fact' };
}

export function displayValueFromInterpretation(question = {}, interpretation = {}) {
  if (question.answerKind === 'choice') {
    const selected = new Set(arr(interpretation.selectedFieldIds).map(String));
    return arr(question.options).filter((option) => selected.has(String(option.fieldId || ''))).map((option) => option.label).filter(Boolean).join(', ');
  }
  return nonEmpty(interpretation.value) ? String(interpretation.value) : '';
}

export function buildInstanceFact({ interaction = {}, question = {}, interpretation = {}, workflowKey = '', scopeKeys = {}, source = 'user' } = {}) {
  const displayValue = displayValueFromInterpretation(question, interpretation);
  let scopeKey = scopeKeyForInteraction(interaction, scopeKeys, workflowKey);
  if (!scopeKey && interaction.valueScope === 'assessment_year' && /assessment.?year/i.test(`${interaction.semanticKey} ${interaction.semanticName}`)) scopeKey = displayValue;
  return {
    semanticKey: interaction.semanticKey,
    value: question.answerKind === 'value' ? interpretation.value : displayValue,
    optionLabel: displayValue,
    source,
    scope: interaction.valueScope || 'filing_instance',
    workflowKey,
    scopeKey,
    confirmed: true
  };
}

export function buildConfirmationSummary({ semanticEntity = {}, items = [] } = {}) {
  const confirmable = arr(items).filter((item) => ['prefilled', 'remembered'].includes(item.status) && item.displayValue);
  return {
    intro: semanticEntity.completionInteraction?.confirmationIntro || 'Before I continue, these details are already set:',
    question: semanticEntity.completionInteraction?.confirmationQuestion || 'Are these correct, or tell me what to change?',
    changeQuestion: semanticEntity.completionInteraction?.changeQuestion || 'Which detail would you like to change?',
    items: confirmable.map((item) => ({ semanticKey: item.semanticKey, label: item.semanticName || item.question || item.semanticKey, value: item.displayValue, source: item.status }))
  };
}

export function buildChangeSelectionQuestion(summary = {}) {
  return {
    questionId: 'interaction:confirmation-change',
    answerKind: 'choice',
    label: summary.changeQuestion || 'Which detail would you like to change?',
    cardinality: 'exactly_one',
    options: arr(summary.items).map((item) => ({ fieldId: item.semanticKey, label: item.label }))
  };
}

export function isAffirmativeConfirmation(answer = '') {
  return /^(y|yes|yeah|yep|ok|okay|correct|continue|looks good|all good)$/i.test(String(answer).trim());
}

export function confirmationDecision(summary = {}, answer = '') {
  const text = norm(answer);
  if (isAffirmativeConfirmation(text)) return 'accept';
  if (/^(n|no|nope|change|wrong|edit|not correct)$/i.test(text)) return 'reject';
  const items = arr(summary.items);
  if (items.length === 1) {
    if (text === '1') return 'accept';
    const value = norm(items[0]?.value || '');
    if (value && text === value) return 'accept';
  }
  return 'change';
}