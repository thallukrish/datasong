export class OdooExecutionAdapter {
  constructor(topology, options = {}) {
    this.topology = topology;
    this.options = options;
  }

  async augment() {
    return { projectMethods: 0, frameworkMethods: 0, bridgedSuperCalls: 0, unresolvedCalls: [], source: null };
  }
}
