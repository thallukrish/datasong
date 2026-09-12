import { assertModelSafe } from './privacyBoundary.js';

export function createModelGateway({ invoke, logger = null } = {}) {
  if (typeof invoke !== 'function') throw new Error('A model invoke function is required.');
  if (logger !== null && (typeof logger.logModelInput !== 'function' || typeof logger.logModelOutput !== 'function')) {
    throw new Error('logger must provide logModelInput() and logModelOutput().');
  }

  return {
    async run({ operation, payload = {} } = {}) {
      const normalizedOperation = String(operation ?? '').trim();
      if (!normalizedOperation) throw new Error('operation is required.');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('payload must be an object.');
      }

      const request = { operation: normalizedOperation, payload };
      assertModelSafe(request);
      if (logger) await logger.logModelInput(request);
      const response = await invoke(request);
      if (logger) await logger.logModelOutput(normalizedOperation, response);
      return response;
    }
  };
}
