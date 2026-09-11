import { assertModelSafe, buildModelPayload } from './privacyBoundary.js';

function uniqueIds(entityIds = []) {
  if (!Array.isArray(entityIds)) throw new Error('entityIds must be an array.');
  return [...new Set(entityIds.filter(Boolean).map((id) => String(id)))];
}

export function createModelGateway({ invoke } = {}) {
  if (typeof invoke !== 'function') {
    throw new Error('A model invoke function is required.');
  }

  return {
    async run({
      entityGraph,
      instanceGraph,
      operation,
      entityIds = []
    } = {}) {
      const normalizedOperation = String(operation ?? '').trim();
      if (!normalizedOperation) throw new Error('operation is required.');

      const safeGraphPayload = buildModelPayload({ entityGraph, instanceGraph });
      const request = {
        operation: normalizedOperation,
        entityIds: uniqueIds(entityIds),
        graph: safeGraphPayload.graph
      };

      assertModelSafe(request);
      return invoke(request);
    }
  };
}
