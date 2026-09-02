export function buildInputHierarchy(inputs = [], page = {}) {
  const root = { pageId: page.id || '', label: page.mainLabel || '', inputIds: [], regions: [] };
  for (const input of inputs) {
    const path = Array.isArray(input.regionPath) ? input.regionPath.filter((label) => label && label !== page.mainLabel) : [];
    let cursor = root;
    for (const label of path) {
      let region = cursor.regions.find((item) => item.label === label);
      if (!region) {
        region = { label, inputIds: [], regions: [] };
        cursor.regions.push(region);
      }
      cursor = region;
    }
    cursor.inputIds.push(input.id);
  }
  return root;
}
