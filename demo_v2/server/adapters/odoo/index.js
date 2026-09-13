import { OdooEntitySchemaAdapter } from './schemaAdapter.js';

export function createOdooAdapters(topology) {
  return {
    entitySchema: new OdooEntitySchemaAdapter(topology),
    execution: null
  };
}

export { OdooEntitySchemaAdapter };
