const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 420) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function schemaRelationshipKey(rel) {
  return `${key(rel?.from)}|${key(rel?.relation)}|${key(rel?.to)}|${arr(rel?.keyMaps).map((m) => `${key(m?.fieldName)}:${key(m?.relatedFieldName)}`).join(',')}`;
}

export const withSchemaEntityRelationships = (Base) => class SchemaEntityRelationshipExplorer extends Base {
  relationshipKeyMaps(sourceSchema, targetSchema, relationship) {
    const rawMaps = arr(relationship?.keyMaps).filter((map) => map?.fieldName);
    const targetFields = new Map(arr(targetSchema?.fields).filter((field) => field?.name).map((field) => [key(field.name), String(field.name)]));
    const targetPks = arr(targetSchema?.fields).filter((field) => field?.isPk && field?.name).map((field) => String(field.name));

    if (rawMaps.length) {
      return rawMaps.map((map, index) => {
        const fieldName = String(map.fieldName);
        let relatedFieldName = String(map.relatedFieldName || '');
        if (!relatedFieldName) {
          relatedFieldName = targetFields.get(key(fieldName)) || '';
          if (!relatedFieldName && targetPks.length === 1) relatedFieldName = targetPks[0];
          if (!relatedFieldName && targetPks.length === rawMaps.length) relatedFieldName = targetPks[index] || '';
        }
        return { fieldName, relatedFieldName, implicit: !map.relatedFieldName };
      }).filter((map) => map.fieldName && map.relatedFieldName);
    }

    const sourceFields = new Set(arr(sourceSchema?.fields).map((field) => key(field?.name)));
    return targetPks
      .filter((pkName) => sourceFields.has(key(pkName)))
      .map((pkName) => ({ fieldName: pkName, relatedFieldName: pkName, implicit: true }));
  }

  schemaRelationshipDetails(entityName) {
    const sourceSchema = this.topology?.entitySchema?.(entityName) || null;
    if (!sourceSchema?.name) return [];
    const out = [];
    for (const relationship of arr(sourceSchema.relationships)) {
      const relatedRaw = String(relationship?.relatedEntityName || '').trim();
      if (!relatedRaw) continue;
      const targetSchema = this.topology?.entitySchema?.(relatedRaw) || null;
      if (!targetSchema?.name) continue;
      const keyMaps = this.relationshipKeyMaps(sourceSchema, targetSchema, relationship);
      const relationLabel = clean(relationship?.title || relationship?.shortAlias || relationship?.type || 'references', 120);
      const joinText = keyMaps.length
        ? keyMaps.map((map) => `${sourceSchema.name}.${map.fieldName} = ${targetSchema.name}.${map.relatedFieldName}`).join(' + ')
        : '';
      out.push({
        from: String(sourceSchema.name),
        relation: relationLabel,
        to: String(targetSchema.name),
        description: joinText
          ? `Schema-defined entity relationship. Join: ${joinText}.`
          : `Schema-defined entity relationship from ${sourceSchema.name} to ${targetSchema.name}; exact join fields are not declared or deterministically resolvable.`,
        relationshipKind: 'schema_fk',
        schemaRelationshipType: String(relationship?.type || ''),
        title: String(relationship?.title || ''),
        shortAlias: String(relationship?.shortAlias || ''),
        keyMaps,
        sourceSchema: sourceSchema.fullName || sourceSchema.name,
        targetSchema: targetSchema.fullName || targetSchema.name,
        schemaSourcePath: sourceSchema.sourcePath || '',
        evidenceType: 'schema_definition',
        evidenced: true
      });
    }
    return out;
  }

  materializeSchemaRelationships(arc) {
    if (!arc) return;
    const byKey = new Map();
    for (const detail of arr(arc.entityDetails)) {
      const relationships = this.schemaRelationshipDetails(detail?.name);
      detail.schemaRelationships = relationships;
      for (const relationship of relationships) byKey.set(schemaRelationshipKey(relationship), relationship);
    }
    arc.schemaRelationships = [...byKey.values()];
  }

  materializeAllSchemaRelationships() {
    for (const arc of arr(this.state?.pass1Arcs)) this.materializeSchemaRelationships(arc);
  }

  enrichArcEntitySchemas(arc) {
    const result = super.enrichArcEntitySchemas(arc);
    this.materializeSchemaRelationships(arc);
    return result;
  }

  persistSemanticMap(...args) {
    this.materializeAllSchemaRelationships();
    return super.persistSemanticMap(...args);
  }

  snapshot(...args) {
    this.materializeAllSchemaRelationships();
    return super.snapshot(...args);
  }
};
