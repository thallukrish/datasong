import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const knowledgeFile = path.join(dataDir, 'semantic-knowledge.json');

export class SemanticStore {
  constructor() {
    this.aliasIds = new Map();
    this.currentScan = null;
    this.state = this.load();
  }

  emptyState() {
    return {
      businessDescription: '',
      repoUrl: '',
      repository: {
        url: '',
        lastScannedCommit: null,
        lastScanAt: null
      },
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
      return {
        ...this.emptyState(),
        ...saved,
        repository: { ...this.emptyState().repository, ...(saved.repository || {}) },
        status: 'idle',
        events: []
      };
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
    this.currentScan = null;
    this.state = this.emptyState();
    try { fs.rmSync(knowledgeFile, { force: true }); } catch {}
    return this.emit({ type: 'knowledge_reset', message: 'Saved demo knowledge cleared' });
  }

  begin({ businessDescription, repoUrl }) {
    this.currentScan = null;
    this.state.businessDescription = businessDescription;
    this.state.repoUrl = repoUrl;
    this.state.repository = { ...this.state.repository, url: repoUrl };
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

  previousCommitFor(repoUrl) {
    if (!sameRepo(this.state.repository?.url || this.state.repoUrl, repoUrl)) return null;
    return this.state.repository?.lastScannedCommit || null;
  }

  setScanContext(scan) {
    this.currentScan = {
      repoUrl: scan.repoUrl,
      currentCommit: scan.currentCommit,
      previousCommit: scan.previousCommit,
      commitChanged: scan.commitChanged,
      comparisonAvailable: scan.comparisonAvailable,
      changedFiles: scan.changedFiles
    };
    this.state.repository = {
      ...this.state.repository,
      url: scan.repoUrl,
      currentCommit: scan.currentCommit,
      previousCommit: scan.previousCommit,
      comparisonAvailable: scan.comparisonAvailable,
      changedFiles: scan.changedFiles
    };
    return this.reusePlan();
  }

  reusePlan() {
    if (!this.currentScan) return { reusable: [], needsReview: [], reason: 'repository has not been prepared yet' };

    const items = this.semanticItems();
    const { previousCommit, currentCommit, commitChanged, comparisonAvailable, changedFiles } = this.currentScan;

    if (!previousCommit) {
      return {
        reusable: [],
        needsReview: items.map((item) => ({ ...item, reason: 'existing knowledge predates commit-aware validation' })),
        reason: 'first commit-aware scan'
      };
    }

    if (!commitChanged) {
      return {
        reusable: items.map((item) => ({ ...item, reason: `repository is still at ${shortSha(currentCommit)}` })),
        needsReview: [],
        reason: 'repository commit unchanged'
      };
    }

    if (!comparisonAvailable || !Array.isArray(changedFiles)) {
      return {
        reusable: [],
        needsReview: items.map((item) => ({ ...item, reason: 'repository changed but Git diff could not be proven' })),
        reason: 'conservative full semantic re-check'
      };
    }

    const changed = new Set(changedFiles.map(normalizePath));
    const reusable = [];
    const needsReview = [];

    for (const item of items) {
      if (!item.evidenceFiles.length) {
        needsReview.push({ ...item, reason: 'no evidence-file provenance recorded yet' });
        continue;
      }
      const touched = item.evidenceFiles.filter((file) => changed.has(normalizePath(file)));
      if (touched.length) needsReview.push({ ...item, reason: 'evidence changed', changedEvidenceFiles: touched });
      else reusable.push({ ...item, reason: 'none of its evidence files changed' });
    }

    return {
      reusable,
      needsReview,
      reason: `${changedFiles.length} repository files changed between ${shortSha(previousCommit)} and ${shortSha(currentCommit)}`,
      changedFiles
    };
  }

  semanticItems() {
    const output = [];
    for (const item of this.state.workflows) output.push(summaryItem('workflow', item.id, item.name, item));
    for (const item of this.state.conditions) output.push(summaryItem('rule', item.id, item.label, item));
    for (const item of this.state.nodes.filter((node) => node.kind === 'business_concept')) output.push(summaryItem('concept', item.id, item.label, item));
    for (const item of this.state.persistentData) output.push(summaryItem('persistent_data', item.id, item.businessLabel, item));
    return output;
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

  withProvenance(value, existing = null) {
    const evidence = unique([...(existing?.evidence || []), ...(value.evidence || [])]);
    const evidenceFiles = unique([...(existing?.evidenceFiles || []), ...extractEvidenceFiles(evidence)]);
    return {
      ...value,
      evidence,
      evidenceFiles,
      sourceCommit: this.currentScan?.currentCommit || existing?.sourceCommit || null,
      lastValidatedCommit: this.currentScan?.currentCommit || existing?.lastValidatedCommit || existing?.sourceCommit || null
    };
  }

  upsertNode(node) {
    const incomingId = node.id;
    const technicalNames = unique(node.technicalNames || []);
    const existing = this.findCanonicalNode(node, technicalNames);
    const canonicalId = existing?.id || this.resolveId(incomingId);
    if (canonicalId !== incomingId) this.aliasIds.set(incomingId, canonicalId);

    const value = this.withProvenance({
      ...node,
      id: canonicalId,
      label: existing?.label || node.label,
      description: betterDescription(existing?.description, node.description),
      technicalNames: unique([...(existing?.technicalNames || []), ...technicalNames]),
      aliases: unique([...(existing?.aliases || []), ...(existing && normalize(existing.label) !== normalize(node.label) ? [node.label] : [])])
    }, existing);

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
    const existing = this.state.edges.find((e) => e.id === id);
    const value = this.withProvenance({ ...edge, id, source, target }, existing);
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
    const value = this.withProvenance({
      ...workflow,
      id,
      name: existing?.name || workflow.name,
      description: betterDescription(existing?.description, workflow.description),
      technicalNames: unique([...(existing?.technicalNames || []), ...(workflow.technicalNames || [])])
    }, existing);
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
    const value = this.withProvenance({
      ...existing,
      ...condition,
      id,
      label: existing?.label || condition.label,
      technicalNames: unique([...(existing?.technicalNames || []), ...(condition.technicalNames || [])])
    }, existing);
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
    const value = this.withProvenance({
      ...existing,
      ...item,
      id,
      businessLabel: existing?.businessLabel || item.businessLabel,
      description: betterDescription(existing?.description, item.description),
      fields: unique([...(existing?.fields || []), ...(item.fields || [])])
    }, existing);
    const idx = this.state.persistentData.findIndex((d) => d.id === id);
    if (idx >= 0) this.state.persistentData[idx] = value;
    else this.state.persistentData.push(value);
    this.persist();
    return this.emit({ type: idx >= 0 ? 'persistent_data_enriched' : 'persistent_data_found', item: value, reused: idx >= 0 });
  }

  complete(summary) {
    this.state.status = 'complete';
    if (this.currentScan?.currentCommit) {
      this.state.repository = {
        ...this.state.repository,
        url: this.currentScan.repoUrl,
        lastScannedCommit: this.currentScan.currentCommit,
        lastScanAt: new Date().toISOString()
      };
    }
    this.persist();
    return this.emit({ type: 'exploration_complete', message: summary });
  }

  knowledgeSummary() {
    return {
      repository: this.state.repository,
      workflows: this.state.workflows.map(({ id, name, technicalNames, sourceCommit, lastValidatedCommit, evidenceFiles }) => ({ id, name, technicalNames, sourceCommit, lastValidatedCommit, evidenceFiles })),
      concepts: this.state.nodes
        .filter((node) => node.kind === 'business_concept')
        .map(({ id, label, aliases, technicalNames, sourceCommit, lastValidatedCommit, evidenceFiles }) => ({ id, label, aliases, technicalNames, sourceCommit, lastValidatedCommit, evidenceFiles })),
      rules: this.state.conditions.map(({ id, label, expression, sourceCommit, lastValidatedCommit, evidenceFiles }) => ({ id, label, expression, sourceCommit, lastValidatedCommit, evidenceFiles })),
      persistentData: this.state.persistentData.map(({ id, businessLabel, technicalName, sourceCommit, lastValidatedCommit, evidenceFiles }) => ({ id, businessLabel, technicalName, sourceCommit, lastValidatedCommit, evidenceFiles }))
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }
}

function summaryItem(type, id, label, item) {
  return {
    type,
    id,
    label,
    sourceCommit: item.sourceCommit || null,
    lastValidatedCommit: item.lastValidatedCommit || item.sourceCommit || null,
    evidenceFiles: unique(item.evidenceFiles || extractEvidenceFiles(item.evidence || []))
  };
}

function extractEvidenceFiles(evidence = []) {
  const files = [];
  for (const entry of evidence) {
    const text = String(entry || '').replaceAll('\\', '/');
    const matches = text.match(/[A-Za-z0-9_.@+\-]+(?:\/[A-Za-z0-9_.@+\-]+)+\.[A-Za-z0-9]+/g) || [];
    files.push(...matches.map((value) => value.replace(/^\.\//, '')));
  }
  return unique(files);
}

function normalize(value = '') {
  return String(value).trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePath(value = '') {
  return String(value).replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function betterDescription(existing = '', incoming = '') {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return incoming.length > existing.length ? incoming : existing;
}

function sameRepo(a = '', b = '') {
  return normalizeRepoUrl(a) === normalizeRepoUrl(b);
}

function normalizeRepoUrl(value = '') {
  return String(value).trim().replace(/\.git$/i, '').replace(/\/+$/, '').toLowerCase();
}

function shortSha(value = '') {
  return value ? String(value).slice(0, 8) : 'unknown';
}

export const semanticStore = new SemanticStore();
