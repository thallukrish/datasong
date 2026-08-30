// Keep framework/schema discovery separate from semantic-map lifecycle. Adapters
// populate topology.entitySchemas; this generic layer ensures the current
// canonical catalog is merged into both restored and newly persisted maps.
export const withSchemaCatalogMaterialization = (Base) => class SchemaCatalogMaterializationExplorer extends Base {
  restorePersistedMapIfAvailable(...args) {
    const restored = super.restorePersistedMapIfAvailable(...args);
    if (restored) this.materializeSchemaCatalogGraph?.();
    return restored;
  }

  schemaCatalogNeedsRefresh() {
    const schemas = Array.isArray(this.topology?.entitySchemas) ? this.topology.entitySchemas : [];
    if (!schemas.length) return true;
    // If a framework adapter is installed, require its framework-owned schemas
    // to be present before treating the runtime catalog as complete.
    if (this.topology?.moquiEntitySchemaAdapter && !schemas.some((schema) => schema?.component === 'moqui-framework')) return true;
    return false;
  }

  async refreshSchemaCatalogForCurrentMap() {
    const repoUrl = String(this.state?.repoUrl || '').trim();
    const expectedCommit = String(this.state?.commit || '').trim();
    if (!repoUrl || !expectedCommit) return { refreshed:false, persisted:false, reason:'missing_map_identity' };

    if (this.schemaCatalogNeedsRefresh()) {
      if (typeof this.topology?.prepare !== 'function') return { refreshed:false, persisted:false, reason:'topology_prepare_unavailable' };
      console.log('[lemap schema-repair] restoring runtime schema catalog for persisted map');
      const prepared = await this.topology.prepare(repoUrl);
      const preparedCommit = String(prepared?.commit || this.topology?.commit || '').trim();
      if (preparedCommit && preparedCommit !== expectedCommit) {
        console.warn(`[lemap schema-repair] skipped persisted-map repair: source commit ${preparedCommit} does not match map commit ${expectedCommit}`);
        return { refreshed:false, persisted:false, reason:'commit_mismatch', expectedCommit, preparedCommit };
      }
    }

    // The repository/commit marker may be unchanged even though the canonical
    // schema catalog has grown (for example after adding framework schemas), so
    // force one fresh materialization against the current catalog.
    this._schemaCatalogGraphMaterializedFor = '';
    const before = Object.keys(this.state?.semanticObjects || {}).length;
    this.materializeSchemaCatalogGraph?.();
    const after = Object.keys(this.state?.semanticObjects || {}).length;
    const schemaCount = Array.isArray(this.topology?.entitySchemas) ? this.topology.entitySchemas.length : 0;

    this.persistSemanticMap?.();
    console.log(`[lemap schema-repair] schema catalog ready: ${schemaCount} entities; semantic objects ${before} -> ${after}; persisted map updated`);
    return { refreshed:true, persisted:true, schemaCount, before, after };
  }

  persistSemanticMap(...args) {
    this.materializeSchemaCatalogGraph?.();
    return super.persistSemanticMap(...args);
  }
};
