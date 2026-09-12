import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseActivePage, connectBrowserSession } from '../src/browser/browserSession.js';

function page(url) {
  return { url: () => url };
}

test('chooseActivePage prefers the last normal http page', () => {
  const pages = [page('chrome://settings'), page('https://example.test/a'), page('https://example.test/b')];
  assert.equal(chooseActivePage(pages).url(), 'https://example.test/b');
});

test('connectBrowserSession attaches over configured CDP and exposes one active page', async () => {
  const chosen = page('https://example.test/app');
  const calls = [];
  const browser = {
    contexts: () => [{ pages: () => [page('chrome://newtab'), chosen] }],
    close: async () => calls.push('close')
  };
  const chromium = {
    connectOverCDP: async (endpoint) => { calls.push(endpoint); return browser; }
  };

  const session = await connectBrowserSession({
    config: { browser: { cdpUrl: 'http://127.0.0.1:9222' } },
    chromium
  });

  assert.equal(session.page, chosen);
  assert.deepEqual(calls, ['http://127.0.0.1:9222']);
  await session.close();
  assert.deepEqual(calls, ['http://127.0.0.1:9222', 'close']);
});

test('connectBrowserSession closes the browser connection when no tab is available', async () => {
  let closed = false;
  const browser = {
    contexts: () => [{ pages: () => [] }],
    close: async () => { closed = true; }
  };
  const chromium = { connectOverCDP: async () => browser };

  await assert.rejects(() => connectBrowserSession({
    config: { browser: { cdpUrl: 'http://127.0.0.1:9222' } },
    chromium
  }), /no chrome tabs/i);
  assert.equal(closed, true);
});
