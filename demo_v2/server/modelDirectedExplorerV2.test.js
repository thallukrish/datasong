import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelDirectedExplorerV2 } from './modelDirectedExplorerV2.js';

function bareExplorer(symbolIds = []) {
  const explorer = Object.create(ModelDirectedExplorerV2.prototype);
  explorer.topology = { symbolById: new Map(symbolIds.map((id) => [id, {}])) };
  explorer.state = { stories: [], step: 2, tokenUsage: {} };
  return explorer;
}

test('candidate descriptors tell the model whether getNeighbors is valid', () => {
  const explorer = bareExplorer(['known']);

  const known = explorer.candidateDescriptor({ id: 'known', label: 'Known', hint: '{}' });
  const synthetic = explorer.candidateDescriptor({ id: 'synthetic', label: 'Synthetic', hint: '{}' });

  assert.equal(known.canGetNeighbors, true);
  assert.equal(synthetic.canGetNeighbors, false);
});

test('neighborhood prompt restricts getNeighbors to expandable candidates', () => {
  const explorer = bareExplorer(['known']);
  const prompt = explorer.buildPrompt({
    kind: 'semantic_neighborhood',
    canonical: { nodes: [{ id: 'known' }, { id: 'synthetic' }], edges: [] }
  }, [
    { id: 'known', label: 'Known', hint: '{}' },
    { id: 'synthetic', label: 'Synthetic', hint: '{}' }
  ]);

  assert.match(prompt, /"canGetNeighbors":true/);
  assert.match(prompt, /"canGetNeighbors":false/);
  assert.match(prompt, /Use getNeighbors only with a candidate whose canGetNeighbors field is true/);
});

test('retry tells the model the exact validation error from the previous response', async () => {
  const explorer = bareExplorer();
  const prompts = [];
  let validations = 0;

  explorer.callAndRecordAttempt = async ({ dynamicPrompt }) => {
    prompts.push(dynamicPrompt);
    return { raw: '{}', callNumber: prompts.length, usage: {} };
  };
  explorer.parseModelOutput = () => ({ evidenceRequest: { type: 'stop' } });
  explorer.validateArtifactResponse = () => {
    validations += 1;
    if (validations === 1) throw new Error('getNeighbors artifactId must identify a known canonical artifact');
  };
  explorer.normalizeDelta = (value) => value;
  explorer.appendRunLog = async () => {};
  explorer.printCallSummary = () => {};

  const result = await explorer.getSemanticUpdate({
    dynamicPrompt: 'ORIGINAL PROMPT',
    observation: { kind: 'artifact' },
    candidates: [],
    before: null
  });

  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /previous response was rejected because: getNeighbors artifactId must identify a known canonical artifact/i);
  assert.equal(result.parsed.next.type, 'stop');
});
