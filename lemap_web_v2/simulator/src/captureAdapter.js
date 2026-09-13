import { validateReplayPage } from './fixtureSchema.js';
import { upsertReplayTransition } from './fixtureStore.js';

function assertSafeStructuralSnapshot(snapshot) {
  try {
    validateReplayPage({ pageId: '__probe__', snapshot });
  } catch (error) {
    if (/snapshot\.(version|url|title|root)|snapshot must be|html/i.test(String(error?.message || ''))) {
      const wrapped = new Error(`Expected a safe structural snapshot: ${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}

export function captureReplayPage({ pageId, snapshot } = {}) {
  assertSafeStructuralSnapshot(snapshot);
  return validateReplayPage({ pageId, snapshot });
}

export function recordObservedTransition({
  fixture,
  fromPageId,
  actionEntityId,
  toPageId
} = {}) {
  return upsertReplayTransition(fixture, {
    fromPageId,
    actionEntityId,
    toPageId
  });
}
