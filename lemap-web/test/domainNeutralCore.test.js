import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const coreFiles = [
  'src/queryAgent.js',
  'src/browserCapture.js',
  'src/graph/entityGraph.js',
  'src/graph/instanceGraph.js',
  'src/graph/graphStore.js',
  'src/graph/structuralEntityBuilder.js',
  'src/graph/structuralChange.js',
  'src/agent/entityFlow.js',
  'src/agent/entityBrowserActions.js',
  'src/semantic/entitySemanticResolver.js'
];

const forbiddenDomainTerms = [
  /\bITR\b/i,
  /assessment_year/i,
  /filing_instance/i,
  /\btaxpayer\b/i,
  /LEMAP_TAXPAYER_SCOPE/i,
  /\bfile return\b/i,
  /\bsubmit return\b/i
];

test('LeMap-Web core contains no income-tax-specific workflow vocabulary', () => {
  for (const relative of coreFiles) {
    const source = fs.readFileSync(path.resolve(relative), 'utf8');
    for (const pattern of forbiddenDomainTerms) {
      assert.doesNotMatch(source, pattern, `${relative} contains domain-specific core logic matching ${pattern}`);
    }
  }
});
