import { assertModelSafe } from './privacyBoundary.js';

export function createModelGateway({ invoke } = {}) {
  if (typeof invoke !== 'function') throw new Error('A model invoke function is required.');

  return {
    async run({ operation, payload = {} } = {}) {
      const normalizedOperation = String(operation ?? '').trim();
      if (!normalizedOperation) throw new Error('operation is required.');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('payload must be an object.');
      }

      const request = { operation: normalizedOperation, payload };
      assertModelSafe(request);
      return invoke(request);
    }
  };
}
