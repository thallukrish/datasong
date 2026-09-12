export function createRuntimeLogView(base, { maxIds = 8 } = {}) {
  if (!base || typeof base.log !== 'function') throw new Error('base logger is required.');
  let previous = '';
  return {
    path: base.path,
    layer: base.layer,
    async log(type, data = {}) {
      const compact = { ...data };
      for (const key of Object.keys(compact)) {
        if (!Array.isArray(compact[key])) continue;
        const values = compact[key];
        if (values.length > maxIds) {
          compact[key] = values.slice(0, maxIds);
          compact[`${key}Truncated`] = values.length - maxIds;
        }
      }
      const signature = JSON.stringify([type, compact]);
      if (signature === previous) return null;
      previous = signature;
      return base.log(type, compact);
    }
  };
}
