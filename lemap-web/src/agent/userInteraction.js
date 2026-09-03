import { findApplicableFact } from './instanceMemory.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function nonEmpty(value) { return value !== null && value !== undefined && String(value).trim() !== ''; }

function interactionFields(graph = {}, interaction = {}) {
  const ids = new Set(arr(interaction.structuralFieldIds).map(String));
  return arr(graph.fields).filter((field) => ids.has(String(field.id)));
}

function currentDisplayValue(graph = {}, state = {}, interaction = {}) {
  const fields = interactionFields(graph, interaction);
  if (!fields.length) return '';
  if (fields.length > 1 || fields.some((field) => ['radio', 'checkbox'].includes(field.type))) {
    const selected = fields.filter((field) => state.fields?.[field.id]?.checked === true).map((field) => field.label || field.value).filter(Boolean);
    return selected.join(', ');
  }
  const field = fields[0];
  const value = state.fields?.[field.id]?.value;
  return nonEmpty(value) ? String(value) : '';
}

function scopeKeyFor(interaction = {}, scopeKeys = {}, workflowKey = '') {
  const scope = interaction.valueScope || 'filing_instance';
  if (scope === 'global') return 'global';
  if (scope === 'taxpayer') return scopeKeys.taxpayer || 'default';
  if (scope === 'workflow') return scopeKeys.workflow || workflowKey;
  return scopeKeys[scope] || '';
}

export function classifyInteractionItems({ graph = {}, state = {}, semanticEntity = {}, instanceMemory = null, workflowKey = '', scopeKeys = {} } = {}) {
  return arr(semanticEntity.interactions).map((interaction) => {
    const displayValue = currentDisplayValue(graph, state, interaction);
    if (displayValue) return { ...interaction, status: 'prefilled', displayValue, source: 'prefill', rememberedFact: null };

    const reusePolicy = interaction.reusePolicy || 'never';
    const scope = interaction.valueScope || 'filing_instance';
    const scopeKey = scopeKeyFor(interaction, scopeKeys, workflowKey);
    const rememberedFact = reusePolicy !== 'never' && scopeKey
      ? findApplicableFact(instanceMemory, { semanticKey: interaction.semanticKey, workflowKey, scope, scopeKey })
      : null;
    if (rememberedFact) {
      return {
        ...interaction,
        status: 'remembered',
        displayValue: rememberedFact.optionLabel || (nonEmpty(rememberedFact.value) ? String(rememberedFact.value) : ''),
        source: 'remembered',
        rememberedFact
      };
    }
    return { ...interaction, status: 'missing', displayValue: '', source: 'user', rememberedFact: null };
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
  const wanted = String(fact.optionLabel || fact.value || '').trim().toLowerCase();
  const choiceFields = fields.filter((field) => ['radio', 'checkbox'].includes(field.type));
  if (choiceFields.length) {
    const selected = choiceFields.filter((field) => [field.label, field.value].some((value) => String(value || '').trim().toLowerCase() === wanted));
    if (!selected.length) return null;
    return { selectedFieldIds: selected.map((field) => field.id), value: '', confidence: 1, reason: 'reused stored workflow fact' };
  }
  return { selectedFieldIds: [], value: fact.value ?? fact.optionLabel ?? '', confidence: 1, reason: 'reused stored workflow fact' };
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

export function isAffirmativeConfirmation(answer = '') {
  return /^(y|yes|yeah|yep|ok|okay|correct|continue|looks good|all good)$/i.test(String(answer).trim());
}
