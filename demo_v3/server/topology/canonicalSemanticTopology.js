import fs from 'node:fs/promises';
import path from 'node:path';
import simpleGit from 'simple-git';
import { SemanticFunctionTopology } from './semanticFunctionTopology.js';

function clean(value) { return String(value ?? '').trim(); }
function safeArray(value) { return Array.isArray(value) ? value : []; }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function attr(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}=["']([^"']+)["']`));
  return match ? match[1] : '';
}
function lineAt(text, offset) { return text.slice(0, offset).split(/\r?\n/).length; }
function isRealSource(sourcePath) { return !!sourcePath && !String(sourcePath).startsWith('$'); }
function parseParams(signature = '') {
  const match = String(signature).match(/\(([^)]*)\)/);
  if (!match) return [];
  return match[1].split(',').map((part) => part.trim().split(/[=:]/)[0].trim()).filter(Boolean);
}
function summarizeValue(value) {
  if (value === undefined) return undefined;
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return { type: 'array', length: value.length };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 12));
  return String(value);
}

export class CanonicalSemanticTopology extends SemanticFunctionTopology {
  constructor(options) {
    super(options);
    this.fileUnits = new Map();
    this.coveredUnits = new Set();
  }

  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);
    await this.harvestStructuredUnits();
    this.reindexAllSymbols();
    this.rebuildCallers();
    this.rebuildCoverageIndex();
    return {
      ...prep,
      semanticFunctions: this.symbols.length,
      sourceCoverage: this.coverageSnapshot(),
      root: this.canonicalizeObservation(this.repositoryOrientation())
    };
  }

  async harvestStructuredUnits() {
    const git = simpleGit(this.repoDir);
    const tracked = (await git.raw(['ls-files'])).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    for (const rel of tracked) {
      const ext = path.extname(rel).toLowerCase();
      if (ext !== '.xml' && ext !== '.json') continue;
      const text = await fs.readFile(path.join(this.repoDir, rel), 'utf8').catch(() => '');
      if (!text || text.length > 1_500_000) continue;
      if (ext === '.xml') this.harvestXml(rel, text);
      else this.harvestJsonObjects(rel, text);
    }
  }

  harvestXml(sourcePath, text) {
    const meaningful = new Set([
      'service-call', 'entity-find', 'entity-find-count', 'entity-one', 'transition', 'set', 'if', 'iterate',
      'section', 'section-iterate', 'subscreens-item', 'service', 'screen', 'actions', 'script', 'condition'
    ]);
    const regex = /<([A-Za-z][\w:-]*)\b[^>]*>/g;
    let match;
    let ordinal = 0;
    while ((match = regex.exec(text))) {
      const tagName = match[1].split(':').at(-1);
      if (!meaningful.has(tagName)) continue;
      const line = lineAt(text, match.index);
      if (this.symbols.some((symbol) => symbol.sourcePath === sourcePath && symbol.startLine === line && String(symbol.symbolKind) === tagName)) continue;
      ordinal += 1;
      const tag = match[0];
      const name = attr(tag, 'name') || attr(tag, 'entity-name') || attr(tag, 'field') || attr(tag, 'field-name') || `${tagName}-${ordinal}`;
      const node = this.addSemanticFunction({
        sourcePath,
        name: `$xml.${tagName}.${name}@${line}`,
        symbolKind: `xml_${tagName.replace(/-/g, '_')}`,
        semanticType: 'structured_element',
        line,
        signature: `$xml.${tagName}(${name})`,
        body: ''
      });
      node.canonicalSeed = {
        kind: tagName,
        attributes: Object.fromEntries([
          ['name', attr(tag, 'name')],
          ['entity', attr(tag, 'entity-name')],
          ['field', attr(tag, 'field-name') || attr(tag, 'field')],
          ['value', attr(tag, 'value')],
          ['from', attr(tag, 'from')],
          ['list', attr(tag, 'list')],
          ['entry', attr(tag, 'entry')],
          ['condition', attr(tag, 'condition')],
          ['location', attr(tag, 'location')]
        ].filter(([, value]) => value))
      };
      if (tagName === 'service-call') {
        const target = attr(tag, 'name');
        if (target) node.references.push({ name: target, simpleName: target.split(/[.:/]/).at(-1), relation: 'calls', explicit: true });
      } else if (['entity-find', 'entity-find-count', 'entity-one'].includes(tagName)) {
        const target = attr(tag, 'entity-name');
        if (target) node.references.push({ name: target, simpleName: target.split(/[.:/]/).at(-1), relation: 'reads', explicit: true });
      } else if (tagName === 'transition') {
        const target = attr(tag, 'name');
        if (target) node.references.push({ name: target, simpleName: target, relation: 'routes_to', explicit: true });
      }
    }
  }

  harvestJsonObjects(sourcePath, text) {
    let root;
    try { root = JSON.parse(text); } catch { return; }
    const base = path.posix.basename(sourcePath).replace(/\.json$/i, '') || 'json';
    const walk = (value, parts = []) => {
      if (Array.isArray(value)) {
        value.forEach((entry, index) => {
          if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
            const identity = clean(entry.id || entry.name || entry.key || entry.type || entry.code || index);
            const logicalPath = [...parts, identity || String(index)].join('.');
            const node = this.addSemanticFunction({
              sourcePath,
              name: `$json.${base}.${logicalPath}`,
              symbolKind: 'json_object',
              semanticType: 'structured_object',
              line: 1,
              signature: `$json.${base}.${logicalPath}() -> object`,
              body: '',
              value: entry
            });
            node.canonicalSeed = { kind: 'json_object', objectPath: logicalPath, fields: Object.keys(entry).slice(0, 30) };
          }
          walk(entry, [...parts, String(index)]);
        });
        return;
      }
      if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) walk(child, [...parts, key]);
      }
    };
    walk(root, []);
  }

  rebuildCoverageIndex() {
    this.fileUnits.clear();
    for (const symbol of this.symbols) {
      if (!isRealSource(symbol.sourcePath)) continue;
      if (!this.fileUnits.has(symbol.sourcePath)) this.fileUnits.set(symbol.sourcePath, []);
      this.fileUnits.get(symbol.sourcePath).push(symbol.id);
    }
  }

  coverageSnapshot() {
    const files = [];
    for (const [sourcePath, unitIds] of this.fileUnits.entries()) {
      const visited = unitIds.filter((id) => this.coveredUnits.has(id)).length;
      files.push({ sourcePath, totalUnits: unitIds.length, visitedUnits: visited, uncoveredUnits: unitIds.length - visited });
    }
    return files.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  }

  coverageFor(sourcePath) {
    const ids = this.fileUnits.get(sourcePath) || [];
    return {
      sourcePath,
      totalUnits: ids.length,
      visitedUnits: ids.filter((id) => this.coveredUnits.has(id)).length,
      uncoveredUnitIds: ids.filter((id) => !this.coveredUnits.has(id))
    };
  }

  canonicalPacket(symbolOrObservation) {
    const symbol = this.symbolById.get(symbolOrObservation?.id) || symbolOrObservation || {};
    const references = safeArray(symbol.references).map((ref) => ({
      relation: ref.relation || 'reference',
      target: ref.name
    }));
    const seed = symbol.canonicalSeed || {};
    const inputs = unique([
      ...parseParams(symbol.signature),
      ...this.extractXmlParameters(symbol.body || '')
    ]);
    const outputs = unique([
      ...this.extractOutputs(symbol.body || ''),
      ...(symbol.semanticValue !== undefined ? ['value'] : [])
    ]);
    const operations = this.extractOperations(symbol, references);
    const conditions = this.extractConditions(symbol.body || '', seed);
    const effects = references
      .filter((ref) => ['writes', 'routes_to', 'publishes_event', 'triggers', 'handles', 'on_success', 'on_error', 'delayed_trigger'].includes(ref.relation))
      .map((ref) => `${ref.relation}:${ref.target}`);

    return {
      id: symbol.id,
      function: symbol.name || symbol.symbolName || symbol.label || symbol.path || symbol.id,
      kind: symbol.semanticType || symbol.symbolKind || symbol.kind || 'semantic_function',
      inputs,
      outputs,
      value: summarizeValue(symbol.semanticValue),
      operations,
      conditions,
      effects,
      references,
      structured: Object.keys(seed).length ? seed : undefined,
      provenance: isRealSource(symbol.sourcePath)
        ? { source: symbol.sourcePath, lines: [symbol.startLine || 1, symbol.endLine || symbol.startLine || 1] }
        : { source: symbol.sourcePath || symbol.path || '' }
    };
  }

  extractXmlParameters(body) {
    const out = [];
    const regex = /<parameter\b[^>]*\bname=["']([^"']+)["']/g;
    let match;
    while ((match = regex.exec(body))) out.push(match[1]);
    return out;
  }

  extractOutputs(body) {
    const out = [];
    let match;
    const returnRegex = /\breturn\s+([A-Za-z_$][\w$]*)/g;
    while ((match = returnRegex.exec(body))) out.push(match[1]);
    const xmlOutputs = /\b(?:out-map|list|count|to-field)=["']([^"']+)["']/g;
    while ((match = xmlOutputs.exec(body))) out.push(match[1]);
    return out;
  }

  extractOperations(symbol, references) {
    const operations = references.map((ref) => ({ type: ref.relation || 'reference', target: ref.target }));
    const seed = symbol.canonicalSeed || {};
    if (seed.kind) operations.unshift({ type: seed.kind, ...(seed.attributes || {}), ...(seed.objectPath ? { objectPath: seed.objectPath } : {}) });
    if (!operations.length && symbol.semanticValue !== undefined) operations.push({ type: 'return_value', value: summarizeValue(symbol.semanticValue) });
    if (!operations.length) operations.push({ type: 'execute', function: symbol.name || symbol.id });
    return operations;
  }

  extractConditions(body, seed = {}) {
    const out = [];
    if (seed.attributes?.condition) out.push(seed.attributes.condition);
    let match;
    const codeIf = /\bif\s*\(([^)]+)\)/g;
    while ((match = codeIf.exec(body))) out.push(match[1].trim());
    const xmlCondition = /\bcondition=["']([^"']+)["']/g;
    while ((match = xmlCondition.exec(body))) out.push(match[1]);
    const econdition = /<econdition\b([^>]*)>/g;
    while ((match = econdition.exec(body))) {
      const field = attr(match[0], 'field-name');
      const value = attr(match[0], 'value') || attr(match[0], 'from');
      if (field) out.push(value ? `${field}=${value}` : field);
    }
    return unique(out);
  }

  canonicalCandidate(candidate) {
    const symbol = this.symbolById.get(candidate?.id);
    if (!symbol) return { ...candidate, hint: clean(candidate?.hint || candidate?.summary || '') };
    const packet = this.canonicalPacket(symbol);
    return {
      ...candidate,
      kind: 'semantic_function',
      symbolKind: symbol.symbolKind,
      label: packet.function,
      hint: JSON.stringify({ kind: packet.kind, inputs: packet.inputs, outputs: packet.outputs, operations: packet.operations.slice(0, 5), conditions: packet.conditions.slice(0, 4) })
    };
  }

  canonicalizeObservation(observation) {
    if (!observation) return observation;
    const symbol = this.symbolById.get(observation.id);
    if (!symbol) {
      return { ...observation, excerpt: '', neighbors: safeArray(observation.neighbors).map((n) => this.canonicalCandidate(n)) };
    }
    const packet = this.canonicalPacket(symbol);
    return {
      ...observation,
      kind: 'semantic_function',
      symbolKind: symbol.symbolKind,
      symbolName: symbol.name,
      summary: `${packet.function} [${packet.kind}]`,
      excerpt: '',
      canonical: packet,
      neighbors: safeArray(observation.neighbors).map((n) => this.canonicalCandidate(n)),
      sourceCoverage: this.coverageFor(symbol.sourcePath)
    };
  }

  representativeUnit(sourcePath) {
    const ids = this.fileUnits.get(sourcePath) || [];
    const symbols = ids.map((id) => this.symbolById.get(id)).filter(Boolean);
    const uncovered = symbols.filter((symbol) => !this.coveredUnits.has(symbol.id));
    const pool = uncovered.length ? uncovered : symbols;
    return pool.sort((a, b) => this.entryPriority(b) - this.entryPriority(a))[0] || null;
  }

  async observe(idOrPath) {
    const raw = String(idOrPath || '');
    const direct = this.symbolById.get(raw);
    if (direct) {
      this.coveredUnits.add(direct.id);
      return this.canonicalizeObservation(await super.observe(direct.id));
    }

    const observation = await super.observe(idOrPath);
    if (observation?.kind === 'file' || String(observation?.id || '').startsWith('file:')) {
      const sourcePath = observation.path || String(observation.id).replace(/^file:/, '');
      const unit = this.representativeUnit(sourcePath);
      if (unit) return this.observe(unit.id);
    }
    if (this.symbolById.has(observation?.id)) this.coveredUnits.add(observation.id);
    return this.canonicalizeObservation(observation);
  }

  async search(query) {
    const hits = await super.search(query);
    const out = [];
    const seen = new Set();
    for (const hit of hits) {
      let candidate = hit;
      if (hit?.kind === 'file' || String(hit?.id || '').startsWith('file:')) {
        const sourcePath = hit.path || String(hit.id).replace(/^file:/, '');
        const unit = this.representativeUnit(sourcePath);
        if (unit) candidate = this.describeSymbolCandidate(unit, 'search');
      }
      candidate = this.canonicalCandidate(candidate);
      if (!candidate?.id || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      out.push(candidate);
    }
    return out;
  }
}
