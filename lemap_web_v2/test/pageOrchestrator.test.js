import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdapterRegistry } from '../src/adapters/adapterRegistry.js';
import { orchestratePage } from '../src/orchestrator/pageOrchestrator.js';

function node(tag, { directText = '', attributes = {}, children = [] } = {}) {
  return { tag, directText, attributes, children };
}

test('orchestratePage walks the visible hierarchy and canonicalizes every node', () => {
  const snapshot = {
    version: 1,
    url: 'https://example.test/filing?session=private',
    title: 'Income Tax Filing',
    root: node('body', {
      children: [
        node('section', {
          directText: 'Filing status',
          children: [
            node('mat-radio-button', {
              attributes: { name: 'FilingStatusRadio' },
              children: [node('span', { directText: 'No' })]
            }),
            node('div', {
              attributes: { role: 'radio', 'aria-label': 'Yes' }
            }),
            node('input', {
              attributes: { type: 'text', name: 'income', placeholder: 'Income' }
            }),
            node('p', { directText: 'Use the value from Form 16.' })
          ]
        })
      ]
    })
  };

  const result = orchestratePage(snapshot);

  assert.equal(result.page.type, 'page');
  assert.equal(result.page.structural.route, '/filing');
  assert.equal(result.entities[0].id, result.page.id);
  assert.equal(result.entities.length, 8);

  const controls = result.entities.filter((entity) => entity.type === 'ui_control');
  assert.deepEqual(controls.map((entity) => [entity.name, entity.structural.controlType]), [
    ['No', 'radio'],
    ['Yes', 'radio'],
    ['Income', 'text']
  ]);

  const paragraph = result.entities.find((entity) => entity.name === 'Use the value from Form 16.');
  assert.equal(paragraph.type, 'container');
  assert.deepEqual(paragraph.structural.path, [0, 3]);
});

test('orchestratePage preserves hierarchy as neutral parent-child edges', () => {
  const snapshot = {
    url: 'https://example.test/form',
    title: 'Form',
    root: node('body', {
      children: [
        node('section', {
          children: [node('button', { directText: 'Continue' })]
        })
      ]
    })
  };

  const result = orchestratePage(snapshot);
  const body = result.entities.find((entity) => entity.structural?.path?.length === 0 && entity.type === 'container');
  const section = result.entities.find((entity) => entity.structural?.path?.join('.') === '0');
  const button = result.entities.find((entity) => entity.name === 'Continue');

  assert.deepEqual(result.hierarchy, [
    { parentId: result.page.id, childId: body.id },
    { parentId: body.id, childId: section.id },
    { parentId: section.id, childId: button.id }
  ]);
});

test('orchestratePage accepts an injected adapter registry', () => {
  const registry = createAdapterRegistry([
    {
      name: 'custom',
      parse(current) {
        if (current.tag !== 'x-choice') return null;
        return {
          entityType: 'ui_control',
          controlType: 'radio',
          tag: 'x-choice',
          role: '',
          name: 'custom-choice',
          label: 'Custom choice',
          href: '',
          disabled: false,
          required: false,
          sourceAdapter: 'custom'
        };
      }
    }
  ]);

  const result = orchestratePage({
    url: 'https://example.test/custom',
    title: 'Custom',
    root: node('body', { children: [node('x-choice')] })
  }, { registry });

  const choice = result.entities.find((entity) => entity.name === 'Custom choice');
  assert.equal(choice.type, 'ui_control');
  assert.equal(choice.structural.sourceAdapter, 'custom');
});

test('orchestratePage rejects snapshots without a root node', () => {
  assert.throws(
    () => orchestratePage({ url: 'https://example.test/form', title: 'Form' }),
    /snapshot root is required/i
  );
});
