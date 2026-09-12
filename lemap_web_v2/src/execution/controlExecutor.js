import { createDefaultAdapterRegistry } from '../adapters/adapterRegistry.js';
import { resolveEntityLocator, createPageLocator } from './entityLocator.js';

const DEFAULT_ADAPTER_REGISTRY = createDefaultAdapterRegistry();

function isVisibleInFrame(activeFrame, entityId) {
  const visible = Array.isArray(activeFrame?.visibleEntityIds)
    ? activeFrame.visibleEntityIds
    : [];
  return visible.includes(entityId);
}

function instancePatch(entityId, value) {
  return value === undefined ? null : { entityId, value };
}

async function executeAdapterAction({ adapterRegistry, page, entity, locator, action }) {
  if (!adapterRegistry || typeof adapterRegistry.forSource !== 'function') return false;
  const adapter = adapterRegistry.forSource(entity.structural?.sourceAdapter);
  if (!adapter || typeof adapter.executeControlAction !== 'function') return false;
  return adapter.executeControlAction({ page, entity, locator, action });
}

export async function executeControlAction({
  page,
  entity,
  activeFrame,
  action = {},
  adapterRegistry = DEFAULT_ADAPTER_REGISTRY
} = {}) {
  if (entity?.type !== 'ui_control') {
    throw new Error('executeControlAction requires a ui_control entity.');
  }
  if (!entity.id) throw new Error('ui_control entity id is required.');
  if (!isVisibleInFrame(activeFrame, entity.id)) {
    throw new Error(`Control ${entity.id} is not actionable in the active frame.`);
  }
  if (entity.structural?.disabled === true) {
    throw new Error(`Control ${entity.id} is disabled.`);
  }

  const locatorSpec = resolveEntityLocator(entity);
  const locator = createPageLocator(page, locatorSpec);
  const type = String(action?.type || '');

  if (await executeAdapterAction({ adapterRegistry, page, entity, locator, action })) {
    return { instancePatch: instancePatch(entity.id, action.value) };
  }

  switch (type) {
    case 'click':
      await locator.click();
      return { instancePatch: null };

    case 'fill':
      await locator.fill(action.value);
      return { instancePatch: instancePatch(entity.id, action.value) };

    case 'select':
      await locator.selectOption(action.value);
      return { instancePatch: instancePatch(entity.id, action.value) };

    case 'check': {
      const checked = action.value !== false;
      if (checked) await locator.check();
      else await locator.uncheck();
      return { instancePatch: instancePatch(entity.id, checked) };
    }

    default:
      throw new Error(`Unsupported control action: ${type || '(empty)'}`);
  }
}
