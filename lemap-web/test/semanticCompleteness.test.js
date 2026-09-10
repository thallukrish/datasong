import test from 'node:test';
import assert from 'node:assert/strict';
import { entitiesNeedingSemantics, semanticCandidatesForCurrentState } from '../src/semantic/entitySemanticResolver.js';

test('relevant choice group remains pending only until it has usable semantics', () => {
  const incomplete = {
    id: 'group:mode',
    name: 'Mode',
    type: 'group',
    structural: { cardinality: 'exactlyOne', values: ['A', 'B'], value: null },
    semantic: {
      meaning: 'Workflow mode',
      selectionRule: 'exactlyOne',
      relevantToGoal: true
    },
    links: []
  };

  assert.deepEqual(entitiesNeedingSemantics([incomplete]).map((entity) => entity.id), ['group:mode']);

  const semanticallyComplete = {
    ...incomplete,
    semantic: {
      ...incomplete.semantic,
      interaction: 'user_input',
      required: true,
      question: 'Which mode?'
    }
  };

  assert.deepEqual(entitiesNeedingSemantics([semanticallyComplete]), []);

  const answered = {
    ...semanticallyComplete,
    structural: { ...semanticallyComplete.structural, value: 'A' }
  };
  assert.deepEqual(entitiesNeedingSemantics([answered]), []);
});

test('current executable actions remain candidates for current-state navigation selection', () => {
  const first = {
    id: 'link:a', name: 'Candidate A', type: 'ui_control',
    structural: { controlType: 'link', visible: true, disabled: false },
    semantic: {}, links: []
  };
  const second = {
    id: 'button:b', name: 'Candidate B', type: 'ui_control',
    structural: { controlType: 'button', visible: true, disabled: false },
    semantic: {}, links: []
  };
  const resolvedInput = {
    id: 'group:status', name: 'Status', type: 'group',
    structural: { cardinality: 'exactlyOne', values: ['A', 'B'], value: 'A' },
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'Which status?' },
    links: []
  };

  assert.deepEqual(
    semanticCandidatesForCurrentState([first, second, resolvedInput]).map((entity) => entity.id),
    ['link:a', 'button:b']
  );
});

test('disabled or hidden actions are not navigation candidates until executable', () => {
  const disabled = {
    id: 'button:later', name: 'Candidate', type: 'ui_control',
    structural: { controlType: 'button', visible: true, disabled: true }, semantic: {}, links: []
  };
  assert.deepEqual(semanticCandidatesForCurrentState([disabled]), []);
});
