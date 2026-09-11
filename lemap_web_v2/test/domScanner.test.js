import test from 'node:test';
import assert from 'node:assert/strict';
import { scanDomTree, captureVisibleDom } from '../src/browser/domScanner.js';

function textNode(text) {
  return { nodeType: 3, textContent: text };
}

function element(tag, { attrs = {}, rect = { width: 100, height: 20 }, style = {}, children = [], text = [] } = {}) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    children,
    childNodes: [...text.map(textNode), ...children],
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value: String(value) })),
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? String(attrs[name]) : null; },
    getBoundingClientRect() { return rect; },
    ownerDocument: null
  };
  node.__style = { display: 'block', visibility: 'visible', ...style };
  return node;
}

function attachDocument(root) {
  const document = {
    defaultView: {
      getComputedStyle(node) { return node.__style || { display: 'block', visibility: 'visible' }; }
    }
  };
  const walk = (node) => {
    node.ownerDocument = document;
    for (const child of node.children || []) walk(child);
  };
  walk(root);
  return root;
}

test('scanDomTree preserves visible hierarchy and direct text without inventing semantics', () => {
  const input = element('input', { attrs: { id: 'income', name: 'income', type: 'text', value: 'PRIVATE-1234' } });
  const section = element('section', { attrs: { id: 'income-section' }, text: ['Income details'], children: [input] });
  const root = attachDocument(element('body', { children: [section] }));

  const result = scanDomTree(root);

  assert.equal(result.tag, 'body');
  assert.equal(result.children[0].tag, 'section');
  assert.equal(result.children[0].directText, 'Income details');
  assert.equal(result.children[0].children[0].tag, 'input');
  assert.equal(result.children[0].children[0].attributes.id, 'income');
  assert.equal(result.children[0].children[0].attributes.name, 'income');
  assert.equal(result.children[0].children[0].attributes.type, 'text');
  assert.equal(Object.hasOwn(result.children[0].children[0].attributes, 'value'), false);
});

test('scanDomTree excludes non-visible and non-content DOM branches', () => {
  const hidden = element('div', { style: { display: 'none' }, text: ['Hidden'] });
  const zeroSized = element('div', { rect: { width: 0, height: 0 }, text: ['Zero'] });
  const script = element('script', { text: ['alert(1)'] });
  const shown = element('div', { text: ['Shown'] });
  const root = attachDocument(element('body', { children: [hidden, zeroSized, script, shown] }));

  const result = scanDomTree(root);

  assert.deepEqual(result.children.map((child) => child.directText), ['Shown']);
});

test('captureVisibleDom returns page metadata plus the local structural tree', async () => {
  const root = attachDocument(element('body', { children: [element('div', { text: ['Hello'] })] }));
  const handle = { evaluate: async (fn) => fn(root) };
  const page = {
    url: () => 'https://example.test/form?session=secret',
    title: async () => 'Example form',
    locator: (selector) => {
      assert.equal(selector, 'body');
      return { elementHandle: async () => handle };
    }
  };

  const snapshot = await captureVisibleDom(page);

  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.url, 'https://example.test/form?session=secret');
  assert.equal(snapshot.title, 'Example form');
  assert.equal(snapshot.root.children[0].directText, 'Hello');
});
