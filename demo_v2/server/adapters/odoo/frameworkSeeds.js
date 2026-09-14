const arr = (value) => Array.isArray(value) ? value : [];

export function frameworkModelSeeds(projectSchemas = []) {
  const projectNames = new Set(
    arr(projectSchemas).map((schema) => String(schema?.name || '')).filter(Boolean)
  );
  const seeds = new Set();

  for (const schema of arr(projectSchemas)) {
    if (schema?.ownership === 'project-extension' && schema?.name) {
      seeds.add(String(schema.name));
    }
    for (const relationship of arr(schema?.relationships)) {
      const name = String(relationship?.relatedEntityName || '');
      if (name && !projectNames.has(name)) seeds.add(name);
    }
  }

  return [...seeds].sort();
}
