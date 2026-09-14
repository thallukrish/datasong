import { OdooEntitySchemaAdapter } from './schemaAdapter.js';
import { OdooFrameworkEnricher } from './frameworkEnricher.js';
import { OdooExecutionAdapter } from './executionAdapter.js';

export function createOdooAdapters(topology) {
  return {
    entitySchema: new OdooEntitySchemaAdapter(topology),
    frameworkEnricher: new OdooFrameworkEnricher(topology),
    execution: new OdooExecutionAdapter(topology)
  };
}

export { OdooEntitySchemaAdapter, OdooFrameworkEnricher, OdooExecutionAdapter };
