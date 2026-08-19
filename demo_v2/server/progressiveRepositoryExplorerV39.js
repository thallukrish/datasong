import { ProgressiveRepositoryExplorerV38 } from './progressiveRepositoryExplorerV38.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function uniqById(values) {
  const seen = new Set();
  const out = [];
  for (const item of arr(values)) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

const WRAPPER_TAGS = new Set(['screen', 'actions', 'condition', 'if', 'else', 'iterate', 'script', 'set']);

export class ProgressiveRepositoryExplorerV39 extends ProgressiveRepositoryExplorerV38 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callpaths-pass1-pass2-xml-compressed-v19';
    return state;
  }

  moquiSymbol(id) {
    const symbol = this.topology.symbolById?.get(id);
    return symbol?.semanticType === 'moqui_executable_xml' ? symbol : null;
  }

  compactXmlToken(symbol) {
    const node = symbol?.moquiXmlNode;
    if (!node) return '';
    const tag = String(node.tag || '');
    const a = node.attrs || {};
    if (tag === 'transition') return `transition:${a.name || node.identity || symbol.simpleName || symbol.name}`;
    if (tag === 'transition-include') return `transition-include:${a.name || node.identity || ''}`;
    if (tag === 'service-call') return `service:${a.name || node.identity || ''}`;
    if (['entity-find', 'entity-find-count', 'entity-one'].includes(tag)) return `read:${a.entityName || node.identity || ''}`;
    if (['entity-create', 'entity-update', 'entity-delete'].includes(tag)) return `write:${a.entityName || node.identity || ''}`;
    if (['default-response', 'conditional-response', 'error-response'].includes(tag)) return `navigate:${a.url || node.identity || ''}`;
    if (tag === 'subscreens-item') return `subscreen:${a.name || node.identity || ''}`;
    if (WRAPPER_TAGS.has(tag)) return '';
    return node.identity ? `${tag}:${node.identity}` : tag;
  }

  xmlFileSymbols(sourcePath) {
    return [...(this.topology.symbolById?.values?.() || [])]
      .filter((symbol) => symbol?.semanticType === 'moqui_executable_xml' && symbol.sourcePath === sourcePath)
      .sort((a, b) => Number(a.moquiXmlNode?.ordinal || 0) - Number(b.moquiXmlNode?.ordinal || 0));
  }

  xmlBranchRoots(symbols) {
    const screen = symbols.find((symbol) => symbol.moquiXmlNode?.tag === 'screen');
    if (!screen) return symbols.filter((symbol) => symbol.moquiXmlNode?.tag === 'transition');
    return symbols.filter((symbol) => symbol.moquiXmlNode?.parentOrdinal === screen.moquiXmlNode?.ordinal);
  }

  ancestorBranch(anchor, symbols) {
    const byOrdinal = new Map(symbols.map((symbol) => [symbol.moquiXmlNode?.ordinal, symbol]));
    let current = anchor;
    while (current) {
      const tag = current.moquiXmlNode?.tag;
      if (['transition', 'transition-include', 'subscreens-item'].includes(tag)) return current;
      const parentOrdinal = current.moquiXmlNode?.parentOrdinal;
      current = parentOrdinal == null ? null : byOrdinal.get(parentOrdinal);
    }
    return null;
  }

  branchTokens(root, symbols) {
    if (!root) return [];
    const rootOrdinal = root.moquiXmlNode?.ordinal;
    const byOrdinal = new Map(symbols.map((symbol) => [symbol.moquiXmlNode?.ordinal, symbol]));
    const descendants = [];
    for (const symbol of symbols) {
      let parent = symbol.moquiXmlNode?.parentOrdinal;
      while (parent != null) {
        if (parent === rootOrdinal) {
          descendants.push(symbol);
          break;
        }
        parent = byOrdinal.get(parent)?.moquiXmlNode?.parentOrdinal ?? null;
      }
    }
    return [root, ...descendants]
      .sort((a, b) => Number(a.moquiXmlNode?.ordinal || 0) - Number(b.moquiXmlNode?.ordinal || 0))
      .map((symbol) => this.compactXmlToken(symbol))
      .filter(Boolean);
  }

  compactXmlExecutionObservation(symbolId) {
    const anchor = this.moquiSymbol(symbolId);
    if (!anchor) return null;
    const symbols = this.xmlFileSymbols(anchor.sourcePath);
    const anchorBranch = this.ancestorBranch(anchor, symbols);
    const roots = anchorBranch ? [anchorBranch] : this.xmlBranchRoots(symbols);
    const branches = roots
      .map((root) => ({
        rootId: root.id,
        label: this.compactXmlToken(root) || root.moquiXmlNode?.tag || root.name,
        flow: this.branchTokens(root, symbols)
      }))
      .filter((branch) => branch.flow.length)
      .slice(0, 20);

    // Look through the XML mechanics in one deterministic hop and expose only
    // semantic exits outside this XML file. Same-file XML wrapper/action nodes
    // remain internal to the compact branch representation above.
    const neighborhood = this.topology.getNeighbors(anchor.id, 4);
    const exits = uniqById(arr(neighborhood?.neighbors).filter((candidate) => {
      const target = this.topology.symbolById?.get(candidate.id);
      if (!target) return false;
      if (target.semanticType !== 'moqui_executable_xml') return true;
      return target.sourcePath !== anchor.sourcePath && ['screen', 'transition', 'transition-include'].includes(target.moquiXmlNode?.tag);
    })).slice(0, 30);

    return {
      id: `xml-execution-summary:${encodeURIComponent(anchor.sourcePath)}:${anchor.moquiXmlNode?.ordinal || 0}`,
      path: anchor.sourcePath,
      kind: 'semantic_neighborhood',
      summary: `Compressed Moqui XML execution for ${anchor.sourcePath}`,
      canonical: {
        kind: 'xml_execution_summary',
        sourcePath: anchor.sourcePath,
        anchor: {
          id: anchor.id,
          function: this.compactXmlToken(anchor) || anchor.name,
          kind: anchor.moquiXmlNode?.tag || 'xml'
        },
        branches,
        compression: {
          rawExecutableNodes: symbols.length,
          branchCount: branches.length,
          exposedExitCount: exits.length,
          policy: 'same-file XML execution is deterministic; LLM scores only compact branches and semantic exits'
        }
      },
      neighbors: exits,
      sourceCoverage: null
    };
  }

  resetArcLocalState(arc) {
    arc.seedStarted = true;
    this.state.executionStack = [];
    this.state.frontier = [];
    this.state.branchSignalTrail = [];
    this.state.flattenedBranches = [];
    this.state.semanticEscapes = [];
    this._currentObservationId = '';
    this._activeNeighborhoodAnchorId = '';
    this.state.lastMessage = `Pass 2 starting ${arc.title} at its deterministic call-path seed.`;
    this.pass1().syncStories();
    this.emit?.();
  }

  async startArcAtSeed(arc) {
    if (!arc?.seedArtifactId || arc.seedStarted) return null;
    const compactXml = this.compactXmlExecutionObservation(arc.seedArtifactId);
    if (compactXml) {
      this.resetArcLocalState(arc);
      this.state.lastMessage = `Pass 2 evaluating compressed XML execution for ${arc.title}.`;
      return compactXml;
    }
    return super.startArcAtSeed(arc);
  }

  async resolveNextAction(action, candidates) {
    const targetId = action?.artifactId || '';
    if (targetId && ['getArtifact', 'getFunction', 'getNeighbors'].includes(action?.type)) {
      const compactXml = this.compactXmlExecutionObservation(targetId);
      if (compactXml) {
        this.state.lastMessage = `Pass 2 collapsed XML execution around ${compactXml.path}; scoring semantic exits.`;
        return compactXml;
      }
    }
    return super.resolveNextAction(action, candidates);
  }
}
