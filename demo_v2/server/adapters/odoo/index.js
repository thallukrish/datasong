import { OdooEntitySchemaAdapter } from './schemaAdapter.js';
import { OdooFrameworkEnricher } from './frameworkEnricher.js';
import { OdooExecutionAdapter } from './executionAdapter.js';
import { OdooAdapter } from './adapter.js';
import { extractOdooUiEntrypoints } from './uiEntrypoints.js';
import { applyOdooPatterns, odooPatternRules } from './patternRegistry.js';
import { assessOdooEvidence } from './evidenceAssessment.js';
import { odooCallPathPriorityProfile } from './callPathPriorityProfile.js';

export function createOdooAdapters(topology) {
  // Static framework traversal is already bounded by method-level cycle protection
  // and maxFrameworkMethods. Do not impose a shallow depth ceiling that truncates
  // legitimate Odoo call chains before they reach their business handoff points.
  const executionOptions = { maxDepth: Number.POSITIVE_INFINITY };

  return {
    adapter: new OdooAdapter(topology, { execution: executionOptions }),
    entitySchema: new OdooEntitySchemaAdapter(topology),
    frameworkEnricher: new OdooFrameworkEnricher(topology),
    execution: new OdooExecutionAdapter(topology, executionOptions),
    callPathPriorityProfile: odooCallPathPriorityProfile
  };
}

export {
  OdooAdapter,
  OdooEntitySchemaAdapter,
  OdooFrameworkEnricher,
  OdooExecutionAdapter,
  extractOdooUiEntrypoints,
  applyOdooPatterns,
  odooPatternRules,
  assessOdooEvidence,
  odooCallPathPriorityProfile
};
