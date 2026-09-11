import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/config.js';

test('loadConfig returns one normalized configuration object with safe defaults', () => {
  const config = loadConfig({});

  assert.deepEqual(config.browser, {
    cdpUrl: 'http://127.0.0.1:9222',
    chromeExecutablePath: '',
    navigationTimeoutMs: 15000,
    actionTimeoutMs: 10000
  });
  assert.deepEqual(config.model, {
    provider: '',
    name: '',
    endpoint: '',
    apiKey: ''
  });
  assert.deepEqual(config.storage, {
    entityGraphPath: 'data/entity-graph.json',
    instanceGraphPath: 'data/instance-graph.json',
    workflowLogPath: 'data/workflows'
  });
  assert.deepEqual(config.runtime, {
    mode: 'hybrid',
    maxSteps: 100,
    diagnostics: false
  });
  assert.deepEqual(config.privacy, {
    enforceModelBoundary: true,
    logRuntimeValues: false
  });
});

test('loadConfig reads browser, model, storage and runtime settings from env input', () => {
  const config = loadConfig({
    LEMAP_WEB_CDP_URL: 'http://localhost:9333',
    LEMAP_WEB_CHROME_PATH: 'C:/Chrome/chrome.exe',
    LEMAP_WEB_NAVIGATION_TIMEOUT_MS: '25000',
    LEMAP_WEB_ACTION_TIMEOUT_MS: '7000',
    LEMAP_WEB_MODEL_PROVIDER: 'openai-compatible',
    LEMAP_WEB_MODEL_NAME: 'demo-model',
    LEMAP_WEB_MODEL_ENDPOINT: 'https://example.test/v1',
    LEMAP_WEB_MODEL_API_KEY: 'secret-key',
    LEMAP_WEB_ENTITY_GRAPH_PATH: 'var/entity.json',
    LEMAP_WEB_INSTANCE_GRAPH_PATH: 'var/instance.json',
    LEMAP_WEB_WORKFLOW_LOG_PATH: 'var/workflows',
    LEMAP_WEB_MODE: 'query',
    LEMAP_WEB_MAX_STEPS: '42',
    LEMAP_WEB_DIAGNOSTICS: 'true'
  });

  assert.equal(config.browser.cdpUrl, 'http://localhost:9333');
  assert.equal(config.browser.chromeExecutablePath, 'C:/Chrome/chrome.exe');
  assert.equal(config.browser.navigationTimeoutMs, 25000);
  assert.equal(config.browser.actionTimeoutMs, 7000);
  assert.equal(config.model.provider, 'openai-compatible');
  assert.equal(config.model.name, 'demo-model');
  assert.equal(config.model.endpoint, 'https://example.test/v1');
  assert.equal(config.model.apiKey, 'secret-key');
  assert.equal(config.storage.entityGraphPath, 'var/entity.json');
  assert.equal(config.storage.instanceGraphPath, 'var/instance.json');
  assert.equal(config.storage.workflowLogPath, 'var/workflows');
  assert.equal(config.runtime.mode, 'query');
  assert.equal(config.runtime.maxSteps, 42);
  assert.equal(config.runtime.diagnostics, true);
});

test('loadConfig validates mode and positive integer settings', () => {
  assert.throws(() => loadConfig({ LEMAP_WEB_MODE: 'anything' }), /mode/i);
  assert.throws(() => loadConfig({ LEMAP_WEB_MAX_STEPS: '0' }), /MAX_STEPS/i);
  assert.throws(() => loadConfig({ LEMAP_WEB_ACTION_TIMEOUT_MS: 'abc' }), /ACTION_TIMEOUT/i);
});

test('loadConfig validates boolean settings instead of accepting ambiguous values', () => {
  assert.throws(() => loadConfig({ LEMAP_WEB_DIAGNOSTICS: 'yes' }), /DIAGNOSTICS/i);
  assert.equal(loadConfig({ LEMAP_WEB_DIAGNOSTICS: '1' }).runtime.diagnostics, true);
  assert.equal(loadConfig({ LEMAP_WEB_DIAGNOSTICS: 'false' }).runtime.diagnostics, false);
});

test('privacy protections cannot be disabled through environment configuration', () => {
  const config = loadConfig({
    LEMAP_WEB_PRIVACY_ENABLED: 'false',
    LEMAP_WEB_LOG_RUNTIME_VALUES: 'true',
    LEMAP_WEB_DIAGNOSTICS: 'true'
  });

  assert.equal(config.privacy.enforceModelBoundary, true);
  assert.equal(config.privacy.logRuntimeValues, false);
});

test('loadConfig does not retain the source env object or expose unrelated environment variables', () => {
  const env = {
    LEMAP_WEB_MODEL_NAME: 'demo-model',
    HOME: '/private/home',
    RANDOM_SECRET: 'do-not-copy'
  };
  const config = loadConfig(env);
  const serialized = JSON.stringify(config);

  env.LEMAP_WEB_MODEL_NAME = 'changed-later';
  assert.equal(config.model.name, 'demo-model');
  assert.equal(serialized.includes('/private/home'), false);
  assert.equal(serialized.includes('do-not-copy'), false);
});
