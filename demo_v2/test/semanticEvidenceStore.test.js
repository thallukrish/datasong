import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticEvidenceStore } from '../server/semanticEvidenceStore.js';

test('semantic object lookup remains indexed while materializing a large catalog', () => {
  const state = { semanticObjects:{} };
  const store = new SemanticEvidenceStore(state);
  const entities = [];
  for (let index = 0; index < 707; index += 1) {
    entities.push(store.ensure({ type:'entity', name:`Entity${index}`, properties:{ schemaResolved:true } }));
  }
  for (let index = 0; index < 4809; index += 1) {
    const entity = entities[index % entities.length];
    const field = store.ensure({ type:'field', name:`${entity.name}.field${index}`, scope:entity.id });
    store.link(entity, 'has field', field, {}, { relationshipKind:'schema_field' });
  }
  const before = Object.keys(state.semanticObjects).length;
  const same = store.ensure({ type:'entity', name:'entity 1' });
  assert.equal(same.id, entities[1].id);
  assert.equal(Object.keys(state.semanticObjects).length, before);
});
