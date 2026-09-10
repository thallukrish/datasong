import test from 'node:test';
import assert from 'node:assert/strict';
import { entitiesNeedingSemantics } from '../src/semantic/entitySemanticResolver.js';

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
