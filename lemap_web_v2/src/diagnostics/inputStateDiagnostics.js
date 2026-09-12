import { activeContext } from '../orchestrator/contextStack.js';

function inputState(state, entityId) {
  const id = String(entityId || '');
  const frame = state?.contextStack ? activeContext(state.contextStack) : null;
  return {
    instanceExists: (state?.instanceGraph?.instances || []).some((entry) => String(entry?.entityId || '') === id),
    appliedInFrame: (frame?.appliedEntityIds || []).map(String).includes(id)
  };
}

export function createInputStateLogger(logger, state) {
  if (!logger || typeof logger.log !== 'function') throw new Error('A logger with log() is required.');
  return {
    async log(type, data = {}) {
      if ((type === 'input.required' || type === 'input.applied') && data?.entityId) {
        return logger.log(type, { ...data, ...inputState(state, data.entityId) });
      }
      return logger.log(type, data);
    }
  };
}
