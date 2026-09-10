import test from 'node:test';
import assert from 'node:assert/strict';
import { entitiesNeedingSemantics, semanticCandidatesForCurrentState } from '../src/semantic/entitySemanticResolver.js';

test('relevant choice group remains unresolved until it has usable user-input semantics', () => {
  const incomplete = {
    id: 'group:mode',
    name: 'Online (Recommended) Offline',
    type: 'group',
    structural: { cardinality: 'exactlyOne', values: ['Online (Recommended)', 'Offline'] },
    semantic: {
      meaning: 'Preferred mode of filing the return',
      selectionRule: 'exactlyOne',
      relevantToGoal: true,
      explanation: 'Online filing is recommended.'
    },
    links: []
  };

  assert.deepEqual(entitiesNeedingSemantics([incomplete]).map((entity) => entity.id), ['group:mode']);

  const complete = {
    ...incomplete,
    semantic: {
      ...incomplete.semantic,
      interaction: 'user_input',
      required: true,
      question: 'How do you want to file your return?'
    }
  };

  assert.deepEqual(entitiesNeedingSemantics([complete]), []);
});

test('current executable navigation is reranked even when it already has complete semantics', () => {
  const stalePriorStep = {
    id: 'link:status', name: 'Select Status', type: 'ui_control',
    structural: { controlType: 'link', visible: true, disabled: false },
    semantic: {
      interaction: 'navigation', relevantToGoal: true, required: true,
      workflowRole: 'continue', navigationPriority: 90, consequence: 'reversible'
    },
    links: []
  };
  const newlyEnabledContinue = {
    id: 'button:continue', name: 'Continue', type: 'ui_control',
    structural: { controlType: 'button', visible: true, disabled: false },
    semantic: {}, links: []
  };
  const resolvedInput = {
    id: 'group:status', name: 'Residential Status', type: 'group',
    structural: { cardinality: 'exactlyOne', values: ['Resident', 'Non Resident'] },
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'What is your residential status?' },
    links: []
  };

  assert.deepEqual(
    semanticCandidatesForCurrentState([stalePriorStep, newlyEnabledContinue, resolvedInput]).map((entity) => entity.id),
    ['link:status', 'button:continue']
  );
});

test('disabled or hidden navigation is not reranked until executable', () => {
  const disabled = {
    id: 'button:later', name: 'Continue', type: 'ui_control',
    structural: { controlType: 'button', visible: true, disabled: true },
    semantic: { interaction: 'navigation', relevantToGoal: true, required: true, workflowRole: 'continue', navigationPriority: 90, consequence: 'reversible' },
    links: []
  };
  assert.deepEqual(semanticCandidatesForCurrentState([disabled]), []);
});
