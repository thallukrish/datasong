import path from 'node:path';
import { connectBrowserSession } from '../browser/browserSession.js';
import { createRunLogger } from '../diagnostics/runLogger.js';
import { createRuntimeLogView } from '../diagnostics/runtimeLogView.js';
import { createModelGateway } from '../semantic/modelGateway.js';
import { createProviderInvoke } from '../semantic/modelProvider.js';
import {
  loadPersistentRunState,
  checkpointRunState,
  runApplication
} from './applicationRunner.js';

const DEFAULT_DEPS = {
  connectBrowserSession,
  createRunLogger,
  createModelGateway,
  createProviderInvoke,
  loadPersistentRunState,
  checkpointRunState,
  runApplication
};

function safeRunErrorData(workflowId, error) {
  const data = {
    workflowId,
    errorCode: String(error?.code || 'RUN_FAILED')
  };
  if (error?.lemapStage) data.stage = String(error.lemapStage);
  if (error?.lemapOperation) data.operation = String(error.lemapOperation);
  if (Number.isInteger(error?.statusCode)) data.statusCode = error.statusCode;
  if (typeof error?.retryable === 'boolean') data.retryable = error.retryable;
  return data;
}

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
  const logDirectory = path.join(path.dirname(config.storage.workflowLogPath), 'logs');
  const logger = await deps.createRunLogger({
    directory: logDirectory,
    workflowId,
    layer: 'layer27'
  });
  const runtimeLogger = createRuntimeLogView(logger, { maxIds: 8 });
  console.log(`[LeMap-Web] log: ${logger.path}`);
  await runtimeLogger.log('run.start', { workflowId });

  const session = await deps.connectBrowserSession({ config, chromium });

  try {
    const invoke = deps.createProviderInvoke({ config: config.model });
    const gateway = deps.createModelGateway({ invoke, logger });
    const state = await deps.loadPersistentRunState({
      workflowId,
      query,
      config
    });

    const result = await deps.runApplication({
      state,
      page: session.page,
      query,
      gateway,
      requestInput,
      maxSteps: config.runtime.maxSteps,
      logger: runtimeLogger,
      checkpoint: (currentState) => deps.checkpointRunState(currentState, config)
    });

    await runtimeLogger.log('run.stop', {
      workflowId,
      completed: result.reason === 'completed',
      stage: result.reason,
      step: result.steps
    });
    return { ...result, logPath: logger.path };
  } catch (error) {
    await runtimeLogger.log('run.error', safeRunErrorData(workflowId, error));
    throw error;
  } finally {
    await session.close();
  }
}
