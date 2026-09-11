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
    adapters: [...registered]
  };
}
