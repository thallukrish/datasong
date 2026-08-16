import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const knowledgeFile = path.join(dataDir, 'semantic-knowledge.json');

export class SemanticStore {
  constructor() {
    this.aliasIds = new Map();
    this.state = this.load();
  }

  emptyState() {
    return {
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

  load() {
    try {
      if (!fs.existsSync(knowledgeFile)) return this.emptyState();
      const saved = JSON.parse(fs.readFileSync(knowledgeFile, 'utf8'));
      return { ...this.emptyState(), ...saved, status: 'idle', events: [] };
    } catch (error) {
      console.warn(`Unable to load saved semantic knowledge: ${error.message}`);
      return this.emptyState();
    }
  }

  persist() {
    fs.mkdirSync(dataDir, { recursive: true });
    const { events, status, ...knowledge } = this.state;
    fs.writeFileSync(knowledgeFile, JSON.stringify(knowledge, null, 2));
  }

  reset() {
    this.aliasIds.clear();
    this.state = this.emptyState();
    try { fs.rmSync(knowledgeFile, { force: true }); } catch {}
    return this.emit({ type: 'knowledge_reset', message: 'Saved demo knowledge cleared' });
  }

  begin({ businessDescription, repoUrl }) {
    this.state.businessDescription = businessDescription;
    this.state.repoUrl = repoUrl;
    this.state.status = 'exploring';
    this.state.events = [];
    this.emit({
      type: 'exploration_started',
      message: this.state.nodes.length
        ? `Continuing from ${this.state.nodes.length} things DataSong already knows`
        : 'Exploration started'
    });
  }

  emit(event) {
    const enriched = { id: crypto.randomUUID(), at: new Date().toISOString(), ...event };
    this.state.events.push(enriched);
    return enriched;
  }

  resolveId(id) {
    let current = id;
    const seen = new Set();
    while (this.aliasIds.has(current) && !seen.has(current)) {
      seen.add(current);
      current = this.aliasIds.get(current);
    }
    return current;
  }

  upsertNode(node) {
    const incomingId = node.id;
    const technicalNames = unique(node.technicalNames || []);
    const existing = this.findCanonicalNode(node, technicalNames);
    const canonicalId = existing?.id || this.resolveId(incomingId);
    if (canonicalId !== incomingId) this.aliasIds.set(incomingId, canonicalId);

    const value = {
      ...node,
      id: canonicalId,
      label: existing?.label || node.label,
      description: betterDescription(existing?.description, node.description),
      technicalNames: unique([...(existing?.technicalNames || []), ...technicalNames]),
      aliases: unique([...(existing?.aliases || []), ...(existing && normalize(existing.label) !== normalize(node.label) ? [node.label] : [])]),
      evidence: unique([...(existing?.evidence || []), ...(node.evidence || [])])
    };

    const idx = this.state.nodes.findIndex((n) => n.id === canonicalId);
    if (idx >= 0) this.state.nodes[idx] = { ...this.state.nodes[idx], ...value };
    else this.state.nodes.push(value);
    this.persist();
    return this.emit({ type: existing ? 'node_enriched' : 'node_upserted', node: value, reused: Boolean(existing) });
  }

  findCanonicalNode(node, technicalNames = []) {
    const resolved = this.resolveId(node.id);
    const byId = this.state.nodes.find((n) => n.id === resolved);
    if (byId) return byId;

    const label = normalize(node.label);
    const byLabel = this.state.nodes.find((n) => n.kind === node.kind && normalize(n.label) === label);
    if (byLabel) return byLabel;

    if (technicalNames.length) {
      const incoming = new Set(technicalNames.map(normalize));
      return this.state.nodes.find((n) =>
        n.kind === node.kind && (n.technicalNames || []).some((name) => incoming.has(normalize(name)))
      );
    }
    return null;
  }

  upsertEdge(edge) {
    const source = this.resolveId(edge.source);
    const target = this.resolveId(edge.target);
    const id = edge.id || `${source}:${edge.relation}:${target}`;
    const value = {
      ...edge,
      id,
      source,
      target,
      evidence: unique([...(this.state.edges.find((e) => e.id === id)?.evidence || []), ...(edge.evidence || [])])
    };
    const idx = this.state.edges.findIndex((e) => e.id === id);
    if (idx >= 0) this.state.edges[idx] = { ...this.state.edges[idx], ...value };
    else this.state.edges.push(value);
    this.persist();
    return this.emit({ type: idx >= 0 ? 'edge_enriched' : 'edge_upserted', edge: value, reused: idx >= 0 });
  }

  addWorkflow(workflow) {
    const resolvedId = this.resolveId(workflow.id);
    const existing = this.state.workflows.find((w) => w.id === resolvedId || normalize(w.name) === normalize(workflow.name));
    const id = existing?.id || resolvedId;
    if (id !== workflow.id) this.aliasIds.set(workflow.id, id);
    const value = {
      ...workflow,
      id,
      name: existing?.name || workflow.name,
      description: betterDescription(existing?.description, workflow.description),
      technicalNames: unique([...(existing?.technicalNames || []), ...(workflow.technicalNames || [])]),
      evidence: unique([...(existing?.evidence || []), ...(workflow.evidence || [])])
    };
    const idx = this.state.workflows.findIndex((w) => w.id === id);
    if (idx >= 0) this.state.workflows[idx] = value;
    else this.state.workflows.push(value);
    this.persist();
    return this.emit({ type: idx >= 0 ? 'workflow_enriched' : 'workflow_found', workflow: value, reused: idx >= 0 });
  }

  addCondition(condition) {
    const resolvedId = this.resolveId(condition.id);
    const existing = this.state.conditions.find((c) =>
      c.id === resolvedId || normalize(c.label) === normalize(condition.label) ||
      (c.expression && condition.expression && normalize(c.expression) === normalize(condition.expression))
    );
    const id = existing?.id || resolvedId;
    if (id !== condition.id) this.aliasIds.set(condition.id, id);
    const value = {
      ...existing,
      ...condition,
      id,
      label: existing?.label || condition.label,
      technicalNames: unique([...(existing?.technicalNames || []), ...(condition.technicalNames || [])]),
      evidence: unique([...(existing?.evidence || []), ...(condition.evidence || [])])
    };
    const idx = this.state.conditions.findIndex((c) => c.id === id);
    if (idx >= 0) this.state.conditions[idx] = value;
    else this.state.conditions.push(value);
    this.persist();
    return this.emit({ type: idx >= 0 ? 'condition_enriched' : 'condition_found', condition: value, reused: idx >= 0 });
  }

  addPersistentData(item) {
    const resolvedId = this.resolveId(item.id);
    const existing = this.state.persistentData.find((d) =>
      d.id === resolvedId || (d.technicalName && item.technicalName && normalize(d.technicalName) === normalize(item.technicalName))
    );
    const id = existing?.id || resolvedId;
    if (id !== item.id) this.aliasIds.set(item.id, id);
    const value = {
      ...existing,
      ...item,
      id,
      businessLabel: existing?.businessLabel || item.businessLabel,
      description: betterDescription(existing?.description, item.description),
      fields: unique([...(existing?.fields || []), ...(item.fields || [])]),
      evidence: unique([...(existing?.evidence || []), ...(item.evidence || [])])
    };
    const idx = this.state.persistentData.findIndex((d) => d.id === id);
    if (idx >= 0) this.state.persistentData[idx] = value;
    else this.state.persistentData.push(value);
    this.persist();
    return this.emit({ type: idx >= 0 ? 'persistent_data_enriched' : 'persistent_data_found', item: value, reused: idx >= 0 });
  }

  complete(summary) {
    this.state.status = 'complete';
    this.persist();
    return this.emit({ type: 'exploration_complete', message: summary });
  }

  knowledgeSummary() {
    return {
      workflows: this.state.workflows.map(({ id, name, technicalNames }) => ({ id, name, technicalNames })),
      concepts: this.state.nodes
        .filter((node) => node.kind === 'business_concept')
        .map(({ id, label, aliases, technicalNames }) => ({ id, label, aliases, technicalNames })),
      rules: this.state.conditions.map(({ id, label, expression }) => ({ id, label, expression })),
      persistentData: this.state.persistentData.map(({ id, businessLabel, technicalName }) => ({ id, businessLabel, technicalName }))
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }
}

function normalize(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function betterDescription(existing = '', incoming = '') {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return incoming.length > existing.length ? incoming : existing;
}

export const semanticStore = new SemanticStore();
