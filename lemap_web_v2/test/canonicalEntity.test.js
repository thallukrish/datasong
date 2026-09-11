import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPageEntity,
  createStructuralEntity
} from '../src/entity/canonicalEntity.js';

test('createPageEntity creates a stable page entity without query-string values', () => {
  const first = createPageEntity({
    url: 'https://example.test/filing/status?session=PRIVATE-1234',
    title: 'Filing status'
  });
  const second = createPageEntity({
    url: 'https://example.test/filing/status?session=OTHER-9999',
    title: 'Filing status'
  });

  assert.equal(first.id, second.id);
  assert.equal(first.type, 'page');
  assert.equal(first.name, 'Filing status');
  assert.deepEqual(first.structural, {
    origin: 'https://example.test',
    route: '/filing/status',
    title: 'Filing status'
  });
  assert.deepEqual(first.semantic, {});
  assert.deepEqual(first.links, []);
  assert.equal(JSON.stringify(first).includes('PRIVATE-1234'), false);
});

test('createStructuralEntity turns an adapter result into a canonical ui_control entity', () => {
  const page = createPageEntity({ url: 'https://example.test/form', title: 'Form' });
  const node = {
    tag: 'mat-radio-button',
    directText: '',
    attributes: { id: 'resident-no', name: 'residentStatus', role: 'radio', class: 'mat-mdc-radio-button' },
    children: []
  };
  const parsedControl = {
    entityType: 'ui_control',
    controlType: 'radio',
    tag: 'mat-radio-button',
    role: 'radio',
    name: 'residentStatus',
    label: 'No',
    href: '',
    disabled: false,
    required: true,
    sourceAdapter: 'angular-material'
  };

  const entity = createStructuralEntity({
    pageId: page.id,
    path: [0, 2, 1],
    node,
    parsedControl
  });

  assert.equal(entity.type, 'ui_control');
  assert.equal(entity.name, 'No');
  assert.equal(entity.structural.controlType, 'radio');
  assert.equal(entity.structural.tag, 'mat-radio-button');
  assert.equal(entity.structural.domId, 'resident-no');
  assert.equal(entity.structural.name, 'residentStatus');
  assert.equal(entity.structural.required, true);
  assert.equal(entity.structural.sourceAdapter, 'angular-material');
  assert.deepEqual(entity.structural.path, [0, 2, 1]);
  assert.deepEqual(entity.semantic, {});
  assert.deepEqual(entity.links, []);
});

test('createStructuralEntity represents relevant non-control elements as container entities', () => {
  const page = createPageEntity({ url: 'https://example.test/form', title: 'Form' });
  const node = {
    tag: 'section',
    directText: 'Income details',
    attributes: { id: 'income-section', class: 'form-section' },
    children: []
  };

  const entity = createStructuralEntity({
    pageId: page.id,
    path: [0, 3],
    node,
    parsedControl: null
  });

  assert.equal(entity.type, 'container');
  assert.equal(entity.name, 'Income details');
  assert.equal(entity.structural.tag, 'section');
  assert.equal(entity.structural.domId, 'income-section');
  assert.deepEqual(entity.structural.path, [0, 3]);
});

test('structural entity identity is deterministic and changes when hierarchy position changes', () => {
  const page = createPageEntity({ url: 'https://example.test/form', title: 'Form' });
  const node = {
    tag: 'div',
    directText: 'Reason',
    attributes: { class: 'question' },
    children: []
  };

  const a = createStructuralEntity({ pageId: page.id, path: [0, 1], node });
  const b = createStructuralEntity({ pageId: page.id, path: [0, 1], node });
  const moved = createStructuralEntity({ pageId: page.id, path: [0, 2], node });

  assert.equal(a.id, b.id);
  assert.notEqual(a.id, moved.id);
});

test('canonical structural entities do not carry runtime value state', () => {
  const page = createPageEntity({ url: 'https://example.test/form', title: 'Form' });
  const node = {
    tag: 'input',
    directText: '',
    attributes: { id: 'pan', name: 'pan', type: 'text' },
    children: []
  };
  const parsedControl = {
    entityType: 'ui_control', controlType: 'text', tag: 'input', role: '', name: 'pan',
    label: 'PAN', href: '', disabled: false, required: true, sourceAdapter: 'native-control'
  };

  const entity = createStructuralEntity({ pageId: page.id, path: [0, 4], node, parsedControl });

  assert.equal(Object.hasOwn(entity.structural, 'value'), false);
  assert.equal(Object.hasOwn(entity.structural, 'checked'), false);
  assert.equal(Object.hasOwn(entity.structural, 'selected'), false);
});
