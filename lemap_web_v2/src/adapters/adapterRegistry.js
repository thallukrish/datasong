import { angularMaterialAdapter } from './angularMaterialAdapter.js';
import { nativeControlAdapter } from './nativeControlAdapter.js';
import { ariaControlAdapter } from './ariaControlAdapter.js';

export function createAdapterRegistry(adapters = []) {
  const registered = Array.isArray(adapters) ? adapters.filter(Boolean) : [];
  return {
    parse(node, context = {}) {
      for (const adapter of registered) {
        if (typeof adapter?.parse !== 'function') continue;
        const parsed = adapter.parse(node, context);
        if (parsed) return parsed;
      }
      return null;
    },
    forSource(sourceAdapter = '') {
      const name = String(sourceAdapter || '').trim();
      if (!name) return null;
      return registered.find((adapter) => String(adapter?.name || '') === name) || null;
    },
    adapters: [...registered]
  };
}

export function createDefaultAdapterRegistry() {
  return createAdapterRegistry([
    angularMaterialAdapter,
    nativeControlAdapter,
    ariaControlAdapter
  ]);
}
