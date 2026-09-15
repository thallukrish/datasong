import { OdooEntitySchemaAdapter } from './schemaAdapter.js';
import { OdooFrameworkEnricher } from './frameworkEnricher.js';
import { OdooExecutionAdapter } from './executionAdapter.js';
import { OdooAdapter } from './adapter.js';
import { extractOdooUiEntrypoints } from './uiEntrypoints.js';
import { assessOdooEvidence } from './evidenceAssessment.js';

export function createOdooAdapters(topology) {
  return {
    adapter: new OdooAdapter(topology),
    entitySchema: new OdooEntitySchemaAdapter(topology),
    frameworkEnricher: new OdooFrameworkEnricher(topology),
    execution: new OdooExecutionAdapter(topology)
  };
}

export {
  OdooAdapter,
  OdooEntitySchemaAdapter,
  OdooFrameworkEnricher,
  OdooExecutionAdapter,
  extractOdooUiEntrypoints,
  assessOdooEvidence
};
