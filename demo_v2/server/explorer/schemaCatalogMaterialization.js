// Keep framework/schema discovery separate from semantic-map lifecycle. Adapters
// populate topology.entitySchemas; this generic layer ensures the current
// canonical catalog is merged into both restored and newly persisted maps.
export const withSchemaCatalogMaterialization = (Base) => class SchemaCatalogMaterializationExplorer extends Base {
  restorePersistedMapIfAvailable(...args) {
    const restored = super.restorePersistedMapIfAvailable(...args);
    if (restored) this.materializeSchemaCatalogGraph?.();
    return restored;
  }

  persistSemanticMap(...args) {
    this.materializeSchemaCatalogGraph?.();
    return super.persistSemanticMap(...args);
  }
};
