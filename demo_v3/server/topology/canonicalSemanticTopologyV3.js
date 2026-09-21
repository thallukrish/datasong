import path from 'node:path';
import { CanonicalSemanticTopologyV2 } from './canonicalSemanticTopologyV2.js';

function isXmlCallSiteMisparsedAsService(symbol) {
  if (symbol?.symbolKind !== 'service') return false;
  const signature = String(symbol.signature || '').trim().toLowerCase();
  const body = String(symbol.body || '').trim().toLowerCase();
  return signature.startsWith('<service-call') || body.startsWith('<service-call');
}

function isStructuredXml(symbol) {
  return String(symbol?.symbolKind || '').startsWith('xml_');
}

export class CanonicalSemanticTopologyV3 extends CanonicalSemanticTopologyV2 {
  async prepare(repoUrl) {
    const prep = await super.prepare(repoUrl);

    // The legacy XML symbol regex matches `service` at the beginning of
    // `<service-call ...>`. Those are call sites, not service definitions.
    // Remove the false symbols; the canonical XML harvester already created
    // the proper `$xml.service-call.*` unit for the same evidence.
    this.symbols = this.symbols.filter((symbol) => !isXmlCallSiteMisparsedAsService(symbol));

    this.reindexAllSymbols();
    this.linkStructuredSourceOrder();
    this.rebuildCallers();
    this.rebuildCoverageIndex();

    return {
      ...prep,
      semanticFunctions: this.symbols.length,
      sourceCoverage: this.coverageSnapshot(),
      root: this.canonicalizeObservation(this.repositoryOrientation())
    };
  }

  linkStructuredSourceOrder() {
    const bySource = new Map();
    for (const symbol of this.symbols) {
      if (path.extname(symbol.sourcePath || '').toLowerCase() !== '.xml') continue;
      if (!isStructuredXml(symbol)) continue;
      if (!bySource.has(symbol.sourcePath)) bySource.set(symbol.sourcePath, []);
      bySource.get(symbol.sourcePath).push(symbol);
    }

    for (const symbols of bySource.values()) {
      symbols.sort((a, b) => Number(a.startLine || 0) - Number(b.startLine || 0));
      for (let i = 0; i < symbols.length - 1; i += 1) {
        const current = symbols[i];
        const next = symbols[i + 1];
        if (!current.references) current.references = [];
        if (!current.references.some((ref) => ref.relation === 'next_in_source' && ref.name === next.name)) {
          current.references.push({
            name: next.name,
            simpleName: next.simpleName || next.name,
            relation: 'next_in_source',
            explicit: true
          });
        }
      }
    }
  }

  entryPriority(symbol) {
    let score = super.entryPriority(symbol);
    const kind = String(symbol?.symbolKind || '');

    // Start from container/trigger semantics, not leaf call sites or config values.
    if (kind === 'xml_screen' || kind === 'screen') score += 140;
    if (kind === 'transition' || kind === 'module_init' || kind === 'ui_event' || kind === 'event') score += 90;
    if (kind === 'xml_actions') score += 55;

    if (kind === 'xml_service_call' || kind === 'xml_entity_find' || kind === 'xml_entity_find_count' || kind === 'xml_entity_one') score -= 70;
    if (['config_value', 'semantic_constant', 'environment_value', 'json_object'].includes(kind)) score -= 45;
    return score;
  }

  relationPriority(relation) {
    if (relation === 'next_in_source') return 92;
    return super.relationPriority(relation);
  }
}
