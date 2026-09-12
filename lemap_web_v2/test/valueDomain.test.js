import test from 'node:test';
import assert from 'node:assert/strict';
import { enumerateEntityValueDomain } from '../src/browser/valueDomain.js';
import { runApplication } from '../src/app/applicationRunner.js';
import { createEntityGraph } from '../src/graph/entityGraph.js';
import { createInstanceGraph } from '../src/graph/instanceGraph.js';
import { createWorkflow } from '../src/workflow/workflowTraversal.js';
import { createFrame, createContextStack } from '../src/orchestrator/contextStack.js';

test('enumerateEntityValueDomain returns native select option labels', async () => {
  const optionLocator = {
    allTextContents: async () => ['Select', '2026-27', '2025-26', '2025-26']
  };
  const locator = {
    locator: (selector) => {
      assert.equal(selector, 'option');
      return optionLocator;
    }
  };
  const page = {
    getByLabel: (label) => {
      assert.equal(label, 'Select Assessment year');
      return locator;
    }
  };
  const entity = {
    id: 'year',
    type: 'ui_control',
    name: 'Select Assessment year',
    structural: { controlType: 'select', tag: 'select', label: 'Select Assessment year' },
    semantic: {},
    links: []
  };

  assert.deepEqual(await enumerateEntityValueDomain(page, entity), ['Select', '2026-27', '2025-26']);
});

test('enumerateEntityValueDomain opens a combobox overlay and reads visible role options', async () => {
  let opened = false;
  let escaped = false;
  const controlLocator = {
    click: async () => { opened = true; },
    locator: () => { throw new Error('native option lookup should not be used'); }
  };
  const options = [
    { isVisible: async () => opened, innerText: async () => '2026-27' },
    { isVisible: async () => opened, innerText: async () => '2025-26' }
  ];
  const roleOptions = {
    count: async () => options.length,
    nth: (index) => options[index]
  };
  const page = {
    getByLabel: () => controlLocator,
    locator: (selector) => {
      assert.equal(selector, '[role="option"]');
      return roleOptions;
    },
    waitForTimeout: async () => {},
    keyboard: { press: async (key) => { assert.equal(key, 'Escape'); escaped = true; } }
  };
  const entity = {
    id: 'year',
    type: 'ui_control',
    name: 'Select Assessment year',
    structural: { controlType: 'select', tag: 'mat-select', role: 'combobox', label: 'Select Assessment year' },
    semantic: {},
    links: []
  };

  assert.deepEqual(await enumerateEntityValueDomain(page, entity), ['2026-27', '2025-26']);
  assert.equal(opened, true);
  assert.equal(escaped, true);
});

test('runner learns missing finite choices before asking the user', async () => {
  const input = {
    id: 'year',
    type: 'ui_control',
    name: 'Select Assessment year',
    structural: { controlType: 'select', label: 'Select Assessment year' },
    semantic: { interaction: 'user_input', relevantToGoal: true, required: true, question: 'For which assessment year?' },
    links: []
  };
  const frame = createFrame({ kind: 'page', contextEntityId: 'page:a', pageEntityId: 'page:a', visibleEntityIds: [input.id] });
  const state = {
    entityGraph: createEntityGraph({ entities: [input] }),
    instanceGraph: createInstanceGraph(),
    workflow: createWorkflow({ id: 'wf:1', originalQuestion: 'q' }),
    contextStack: createContextStack(frame)
  };
  let selected = false;
  const seen = [];

  const result = await runApplication({
    state,
    page: {},
    gateway: {},
    requestInput: async (question) => {
      seen.push(question.options);
      return '2025-26';
    },
    checkpoint: async () => {},
    deps: {
      enrichEntitySemantics: async () => ({ called: false, updatedEntityIds: [] }),
      selectReusableInput: () => null,
      selectNextRequiredInput: () => selected ? null : input,
      enumerateEntityValueDomain: async () => ['2026-27', '2025-26'],
      applyInputValue: async () => { selected = true; },
      captureVisibleDom: async () => ({ url: 'https://example.test/a' }),
      pageIdForSnapshot: () => 'page:a',
      refreshCurrentPage: () => ({}),
      selectNavigationCandidates: () => []
    }
  });

  assert.equal(result.reason, 'completed');
  assert.deepEqual(seen, [['2026-27', '2025-26']]);
  assert.deepEqual(state.entityGraph.entities.find((entity) => entity.id === input.id).structural.values, ['2026-27', '2025-26']);
});
