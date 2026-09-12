import { connectBrowserSession } from '../browser/browserSession.js';
import { createModelGateway } from '../semantic/modelGateway.js';
import { createProviderInvoke } from '../semantic/modelProvider.js';
import {
  loadPersistentRunState,
  checkpointRunState,
  runApplication
} from './applicationRunner.js';

const DEFAULT_DEPS = {
  connectBrowserSession,
  createModelGateway,
  createProviderInvoke,
  loadPersistentRunState,
  checkpointRunState,
  runApplication
};

export async function runConfiguredApplication({
  config,
  workflowId,
  query = '',
  requestInput,
  chromium,
  deps: overrides = {}
} = {}) {
  if (!config?.browser || !config?.model || !config?.storage || !config?.runtime) {
    throw new Error('A complete application configuration is required.');
  }
  if (!workflowId) throw new Error('workflowId is required.');

  const deps = { ...DEFAULT_DEPS, ...overrides };
  const session = await deps.connectBrowserSession({ config, chromium });

  try {
    const invoke = deps.createProviderInvoke({ config: config.model });
    const gateway = deps.createModelGateway({ invoke });
    const state = await deps.loadPersistentRunState({
      workflowId,
      query,
      config
    });

    return await deps.runApplication({
      state,
      page: session.page,
      query,
      gateway,
      requestInput,
      maxSteps: config.runtime.maxSteps,
      checkpoint: (currentState) => deps.checkpointRunState(currentState, config)
    });
  } finally {
    await session.close();
  }
}
