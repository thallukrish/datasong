const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 420) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function schemaRelationshipKey(rel) {
  return `${key(rel?.from)}|${key(rel?.relation)}|${key(rel?.to)}|${arr(rel?.keyMaps).map((m) => `${key(m?.fieldName)}:${key(m?.relatedFieldName)}`).join(',')}`;
}

export const withSchemaEntityRelationships = (Base) => class SchemaEntityRelationshipExplorer extends Base {
  relationshipKeyMaps(sourceSchema, targetSchema, relationship) {
    const explicit = arr(relationship?.keyMaps)
      .map((map) => ({ fieldName: String(map?.fieldName || ''), relatedFieldName: String(map?.relatedFieldName || map?.fieldName || '') }))
      .filter((map) => map.fieldName && map.relatedFieldName);
    if (explicit.length) return explicit;

    // In Moqui an omitted key-map means same-name fields for the related PK.
    // Materialize it only when both sides are present, so this remains deterministic schema evidence.
    const sourceFields = new Set(arr(sourceSchema?.fields).map((field) => key(field?.name)));
    return arr(targetSchema?.fields)
      .filter((field) => field?.isPk && field?.name && sourceFields.has(key(field.name)))
      .map((field) => ({ fieldName: String(field.name), relatedFieldName: String(field.name), implicit: true }));
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
          : `Schema-defined entity relationship from ${sourceSchema.name} to ${targetSchema.name}.`,
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
    const existing = arr(arc.relationshipDetails);
    const byKey = new Map(existing.map((relationship) => [schemaRelationshipKey(relationship), relationship]));
    for (const detail of arr(arc.entityDetails)) {
      const relationships = this.schemaRelationshipDetails(detail?.name);
      detail.schemaRelationships = relationships;
      for (const relationship of relationships) {
        const relationshipKey = schemaRelationshipKey(relationship);
        if (!byKey.has(relationshipKey)) byKey.set(relationshipKey, relationship);
      }
    }
    arc.relationshipDetails = [...byKey.values()];
  }

  enrichArcEntitySchemas(arc) {
    const result = super.enrichArcEntitySchemas(arc);
    this.materializeSchemaRelationships(arc);
    return result;
  }

  snapshot(...args) {
    // Upgrade maps loaded from disk too; no workflow relearning is required.
    for (const arc of arr(this.state?.pass1Arcs)) this.materializeSchemaRelationships(arc);
    return super.snapshot(...args);
  }
};
