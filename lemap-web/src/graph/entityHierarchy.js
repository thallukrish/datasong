export function buildEntityHierarchy(fields = [], entity = {}) {
  const root = { entityId: entity.id || '', label: entity.label || '', fieldIds: [], regions: [] };
  for (const field of fields) {
    const path = Array.isArray(field.regionPath) ? field.regionPath.filter((label) => label && label !== entity.label) : [];
    let cursor = root;
    for (const label of path) {
      let region = cursor.regions.find((item) => item.label === label);
      if (!region) {
        region = { label, fieldIds: [], regions: [] };
        cursor.regions.push(region);
      }
      cursor = region;
    }
    cursor.fieldIds.push(field.id);
  }
  return root;
}
