const MODES = new Set(['learn', 'query', 'hybrid']);

function text(env, key, fallback = '') {
  const value = env?.[key];
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value).trim();
}

function positiveInteger(env, key, fallback) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return value;
}

function booleanValue(env, key, fallback) {
  const raw = env?.[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  throw new Error(`${key} must be true/false or 1/0.`);
}

export function loadConfig(env = process.env) {
  const mode = text(env, 'LEMAP_WEB_MODE', 'hybrid').toLowerCase();
  if (!MODES.has(mode)) {
    throw new Error(`LEMAP_WEB_MODE must be one of: ${[...MODES].join(', ')}.`);
  }

  return {
    browser: {
      cdpUrl: text(env, 'LEMAP_WEB_CDP_URL', 'http://127.0.0.1:9222'),
      chromeExecutablePath: text(env, 'LEMAP_WEB_CHROME_PATH', ''),
      navigationTimeoutMs: positiveInteger(env, 'LEMAP_WEB_NAVIGATION_TIMEOUT_MS', 15000),
      actionTimeoutMs: positiveInteger(env, 'LEMAP_WEB_ACTION_TIMEOUT_MS', 10000)
    },
    model: {
      provider: text(env, 'LEMAP_WEB_MODEL_PROVIDER', ''),
      name: text(env, 'LEMAP_WEB_MODEL_NAME', ''),
      endpoint: text(env, 'LEMAP_WEB_MODEL_ENDPOINT', ''),
      apiKey: text(env, 'LEMAP_WEB_MODEL_API_KEY', '')
    },
    storage: {
      entityGraphPath: text(env, 'LEMAP_WEB_ENTITY_GRAPH_PATH', 'data/entity-graph.json'),
      instanceGraphPath: text(env, 'LEMAP_WEB_INSTANCE_GRAPH_PATH', 'data/instance-graph.json'),
      workflowLogPath: text(env, 'LEMAP_WEB_WORKFLOW_LOG_PATH', 'data/workflows')
    },
    runtime: {
      mode,
      maxSteps: positiveInteger(env, 'LEMAP_WEB_MAX_STEPS', 100),
      diagnostics: booleanValue(env, 'LEMAP_WEB_DIAGNOSTICS', false)
    },
    privacy: {
      enforceModelBoundary: true,
      logRuntimeValues: false
    }
  };
}
