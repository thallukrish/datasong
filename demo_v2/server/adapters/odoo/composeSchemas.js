const arr = (value) => Array.isArray(value) ? value : [];

function dedupeBy(items, keyFor) {
  const map = new Map();
  for (const item of items) map.set(keyFor(item), item);
  return [...map.values()];
}

function mergeSchemaFragments(fragments = []) {
  const valid = arr(fragments).filter(Boolean);
  if (!valid.length) return null;
  const first = valid[0];
  return {
    ...first,
    fields: dedupeBy(valid.flatMap((schema) => arr(schema.fields)), (field) => String(field?.name || '')).filter((field) => field?.name),
    relationships: dedupeBy(
      valid.flatMap((schema) => arr(schema.relationships)),
      (relationship) => `${relationship?.type || ''}|${relationship?.relatedEntityName || ''}|${relationship?.title || ''}`
    ),
    inherits: [...new Set(valid.flatMap((schema) => arr(schema.inherits)).filter(Boolean))]
  };
}

export function composeOdooSchemas({ frameworkSchemas = [], projectSchemas = [] } = {}) {
  const frameworkByName = new Map();
  const projectByName = new Map();

  for (const schema of arr(frameworkSchemas)) {
    if (!schema?.name) continue;
    if (!frameworkByName.has(schema.name)) frameworkByName.set(schema.name, []);
    frameworkByName.get(schema.name).push(schema);
  }
  for (const schema of arr(projectSchemas)) {
    if (!schema?.name) continue;
    if (!projectByName.has(schema.name)) projectByName.set(schema.name, []);
    projectByName.get(schema.name).push(schema);
  }

  const names = [...new Set([...frameworkByName.keys(), ...projectByName.keys()])].sort();
  const effective = [];

  for (const name of names) {
    const framework = mergeSchemaFragments(frameworkByName.get(name));
    const project = mergeSchemaFragments(projectByName.get(name));

    if (framework && project) {
      const fields = dedupeBy(
        [...arr(framework.fields), ...arr(project.fields)],
        (field) => String(field?.name || '')
      ).filter((field) => field?.name);
      const relationships = dedupeBy(
        [...arr(framework.relationships), ...arr(project.relationships)],
        (relationship) => `${relationship?.type || ''}|${relationship?.relatedEntityName || ''}|${relationship?.title || ''}`
      );
      effective.push({
        ...framework,
        fields,
        relationships,
        ownership: 'composed',
        layers: ['framework', 'project-extension'],
        frameworkSchema: framework.stableId,
        projectExtensionSources: arr(projectByName.get(name)).map((schema) => schema?.provenance).filter(Boolean),
        projectProvenance: project.provenance
      });
      continue;
    }

    if (framework) {
      effective.push({ ...framework, layers: ['framework'] });
      continue;
    }

    if (project) effective.push({ ...project, layers: [project.ownership === 'project-extension' ? 'project-extension' : 'project'] });
  }

  return effective;
}
