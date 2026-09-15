import fs from 'node:fs/promises';
import path from 'node:path';
import { OdooEntitySchemaAdapter } from './schemaAdapter.js';
import { OdooFrameworkEnricher } from './frameworkEnricher.js';
import { OdooExecutionAdapter } from './executionAdapter.js';
import { extractOdooUiEntrypoints } from './uiEntrypoints.js';
import { assessOdooEvidence } from './evidenceAssessment.js';

const arr = (value) => Array.isArray(value) ? value : [];

export class OdooAdapter {
  constructor(topology, options = {}) {
    this.topology = topology;
    this.options = options;
    this.schemaAdapter = options.schemaAdapter || new OdooEntitySchemaAdapter(topology);
    this.frameworkEnricher = options.frameworkEnricher || new OdooFrameworkEnricher(topology, options.framework || {});
    this.executionAdapter = options.executionAdapter || new OdooExecutionAdapter(topology, options.execution || {});
  }

  async collectUiEvidence() {
    const repoDir = this.topology?.repoDir || '';
    const trackedFiles = arr(this.topology?.trackedFiles);
    const entrypoints = [];
    const modelActions = [];

    for (const sourcePath of trackedFiles.filter((file) => /\.xml$/i.test(file))) {
      const xml = await fs.readFile(path.join(repoDir, sourcePath), 'utf8').catch(() => '');
      if (!xml) continue;
      const parsed = extractOdooUiEntrypoints(sourcePath, xml);
      entrypoints.push(...arr(parsed.entrypoints));
      modelActions.push(...arr(parsed.modelActions));
    }

    return { entrypoints, modelActions };
  }

  async assess() {
    const ui = await this.collectUiEvidence();
    return {
      ui,
      evidence: assessOdooEvidence({ uiEntrypoints: ui.entrypoints })
    };
  }

  async augment() {
    const ui = await this.collectUiEvidence();
    const schema = await this.schemaAdapter.augment();
    const framework = await this.frameworkEnricher.augment(arr(schema?.schemas));
    const execution = await this.executionAdapter.augment({ entrypoints: ui.entrypoints });

    const projectMethodCount = Number(execution?.projectMethods || 0);
    const frameworkMethodCount = Number(execution?.frameworkMethods || 0);
    const unresolvedCalls = arr(execution?.unresolvedCalls);
    const ambiguousBoundaries = arr(execution?.ambiguousBoundaries);
    const declarativeOnly = arr(schema?.schemas).length > 0
      && ui.entrypoints.length === 0
      && projectMethodCount === 0
      && frameworkMethodCount === 0;

    const evidence = assessOdooEvidence({
      uiEntrypoints: ui.entrypoints,
      projectMethodCount,
      frameworkMethodCount,
      unresolvedCalls,
      ambiguousBoundaries,
      declarativeOnly
    });

    return {
      adapter: 'odoo-v2',
      ui,
      schema,
      framework,
      execution,
      evidence
    };
  }
}
