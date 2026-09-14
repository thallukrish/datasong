import { OdooEntitySchemaAdapter } from './schemaAdapter.js';
import { OdooFrameworkEnricher } from './frameworkEnricher.js';

export function createOdooAdapters(topology) {
  return {
    entitySchema: new OdooEntitySchemaAdapter(topology),
    frameworkEnricher: new OdooFrameworkEnricher(topology),
    execution: null
  };
}

export { OdooEntitySchemaAdapter, OdooFrameworkEnricher };
