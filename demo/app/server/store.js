export class SemanticStore {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      businessDescription: '',
      repoUrl: '',
      status: 'idle',
      events: [],
      nodes: [],
      edges: [],
      workflows: [],
      conditions: [],
      persistentData: []
    };
  }

  begin({ businessDescription, repoUrl }) {
    this.reset();
    this.state.businessDescription = businessDescription;
    this.state.repoUrl = repoUrl;
    this.state.status = 'exploring';
    this.emit({ type: 'exploration_started', message: 'Exploration started' });
  }

  emit(event) {
    const enriched = { id: crypto.randomUUID(), at: new Date().toISOString(), ...event };
    this.state.events.push(enriched);
    return enriched;
  }

  upsertNode(node) {
    const idx = this.state.nodes.findIndex((n) => n.id === node.id);
    if (idx >= 0) this.state.nodes[idx] = { ...this.state.nodes[idx], ...node };
    else this.state.nodes.push(node);
    return this.emit({ type: 'node_upserted', node });
  }

  upsertEdge(edge) {
    const id = edge.id || `${edge.source}:${edge.relation}:${edge.target}`;
    const value = { ...edge, id };
    const idx = this.state.edges.findIndex((e) => e.id === id);
    if (idx >= 0) this.state.edges[idx] = { ...this.state.edges[idx], ...value };
    else this.state.edges.push(value);
    return this.emit({ type: 'edge_upserted', edge: value });
  }

  addWorkflow(workflow) {
    if (!this.state.workflows.find((w) => w.id === workflow.id)) this.state.workflows.push(workflow);
    return this.emit({ type: 'workflow_found', workflow });
  }

  addCondition(condition) {
    if (!this.state.conditions.find((c) => c.id === condition.id)) this.state.conditions.push(condition);
    return this.emit({ type: 'condition_found', condition });
  }

  addPersistentData(item) {
    if (!this.state.persistentData.find((d) => d.id === item.id)) this.state.persistentData.push(item);
    return this.emit({ type: 'persistent_data_found', item });
  }

  complete(summary) {
    this.state.status = 'complete';
    return this.emit({ type: 'exploration_complete', message: summary });
  }

  snapshot() {
    return structuredClone(this.state);
  }
}

export const semanticStore = new SemanticStore();
