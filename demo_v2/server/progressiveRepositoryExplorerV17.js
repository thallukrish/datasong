import { ProgressiveRepositoryExplorerV16 } from './progressiveRepositoryExplorerV16.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function slim(value, max = 260) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

const SYSTEM = `You are DataSong's Pass-1 semantic navigator. Discover broad end-to-end business use cases, not implementation detail. Current artifact evidence may be detailed; candidate evidence is signature-level only. Score continuity/coherence/gain absolutely. DataSong owns repository mechanics, DFS, backtracking, coverage and candidate selection. Return strict JSON matching the supplied mode contract.`;

const SCORE = `Scores: continuity/coherence/gain are 0..1; .25 weak, .5 plausible, .75 strong, 1 near-direct/central/high-gain. Do not inflate the best of a weak set.`;

export class ProgressiveRepositoryExplorerV17 extends ProgressiveRepositoryExplorerV16 {
  compactThreads() {
    return this.state.stories.map((story) => ({ id: story.id, title: story.title }));
  }

  compactProtos() {
    return this.state.protoThreads.map((proto) => ({ id: proto.id, title: proto.title }));
  }

  compactArcBoard() {
    return {
      active: typeof this.activeArcTitle === 'function' ? this.activeArcTitle() : '',
      arcs: this.state.pass1Arcs.map((arc) => ({ title: arc.title, status: arc.status, stages: arr(arc.majorStages).slice(-6) })).slice(-8),
      pending: this.state.pass1ArcSeeds.filter((seed) => seed.status === 'pending').map((seed) => seed.title).slice(0, 8)
    };
  }

  compactCandidate(candidate) {
    const d = this.candidateDescriptor(candidate);
    if (!d) return null;
    return {
      id: d.id,
      name: d.name,
      kind: d.kind,
      relation: d.relation,
      signature: slim(d.signature, 220),
      ...(d.searchMatch ? { match: d.searchMatch } : {})
    };
  }

  buildPrompt(observation, candidates) {
    const kind = observation?.kind;

    if (kind === 'repo_directory') {
      return `MODE orientation\nDIR ${JSON.stringify(observation.canonical || {})}\nRETURN {"evidenceRequest":{"type":"listDirectory|getArtifact|stop","artifactId":"exact id if file","path":"exact child/drill path if directory"}}\nChoose one promising child; never relist the directory already shown.`;
    }

    if (kind === 'source_file_index') {
      const funcs = arr(observation.canonical?.functions).map((f) => ({ id: f.id, name: f.name, signature: slim(f.signature, 220) }));
      return `MODE source-index\nFILE ${observation.path || ''}\nFUNCTIONS ${JSON.stringify(funcs)}\nRETURN {"evidenceRequest":{"type":"getFunction|getArtifact|listDirectory|backtrack|stop","artifactId":"exact id","path":"directory path only"}}\nSignatures only. Choose a function likely to reveal business behavior.`;
    }

    if (kind === 'semantic_neighborhood') {
      const available = arr(candidates).map((c) => this.compactCandidate(c)).filter(Boolean);
      const ctx = {
        arc: typeof this.activeArcTitle === 'function' ? this.activeArcTitle() : '',
        query: observation?.canonical?.kind === 'semantic_search_results' ? observation?.canonical?.query : undefined,
        alternates: arr(observation?.canonical?.alternateQueriesRemaining),
        anchor: observation?.canonical?.anchor?.function || observation?.canonical?.anchor?.id || undefined
      };
      return `MODE candidates\nCTX ${JSON.stringify(ctx)}\nCANDIDATES ${JSON.stringify(available)}\n${SCORE}\nRETURN {"candidateScores":[{"artifactId":"exact id","threadId":"existing id|NEW|UNATTACHED","continuity":0,"coherence":0,"expectedGain":0,"reason":"brief"}],"evidenceRequest":{"type":"advance|getArtifact|getNeighbors|searchSemantic|backtrack|stop","artifactId":"exact id if used","depth":2,"query":"keywords if search","alternateQueries":["optional"],"reason":"brief"}}\nScore only supplied signatures. Bodies are intentionally absent.`;
    }

    if (['semantic_function', 'xml_file', 'config_file', 'text_file'].includes(kind)) {
      const current = observation?.canonical || {};
      const available = arr(candidates).map((c) => this.compactCandidate(c)).filter(Boolean);
      const threads = this.compactThreads();
      const protos = this.compactProtos();
      const board = this.compactArcBoard();
      return `MODE artifact\nCURRENT ${JSON.stringify(current)}\nARC ${JSON.stringify(board)}\nTHREADS ${JSON.stringify(threads)}\nPROTOS ${JSON.stringify(protos)}\nCANDIDATES ${JSON.stringify(available)}\n${SCORE}\nRETURN {"meaning":"brief business meaning","threadFits":[{"threadId":"each supplied thread id","continuity":0,"coherence":0,"bridge":"brief"}],"bestThread":"existing id|NEW|UNATTACHED","relation":"continue|branch|subflow|new_thread|unattached","placement":{"type":"after|before|between|branch_from|parallel|unknown","confidence":0},"newThread":{"title":"only if NEW","concept":"brief"},"semanticGain":0,"closes":"none|branch|thread","openQuestion":"optional","protoThreadFits":[{"protoThreadId":"each supplied proto id","continuity":0,"coherence":0,"bridge":"brief"}],"protoAction":{"type":"new|extend|promote|none","protoThreadId":"if needed","title":"if needed","concept":"if needed"},"pass1":{"evidenceRole":"major|supporting|trivial","collapsedMeaning":"brief","arc":{"title":"business use case or empty","trigger":"actor/intent","majorStages":["broad stage"],"outcome":"business outcome","entities":["major entity"],"relationships":["major relationship"],"status":"forming|broadly_complete|not_a_business_arc"},"arcSeeds":[{"title":"other business use case","reason":"brief"}]},"evidenceRequest":{"type":"getFunction|getArtifact|getNeighbors|listDirectory|searchSemantic|backtrack|stop","artifactId":"exact id if used","depth":2,"path":"directory if used","query":"keywords if search","alternateQueries":["optional"],"reason":"brief"}}\nPass 1: keep only broad stages/decisions/entities/outcome. Current artifact is detailed; candidates are signature-only. Keep all text fields brief.`;
    }

    return super.buildPrompt(observation, candidates);
  }

  async callModel(dynamicPrompt) {
    return this.lightweightModelCall(SYSTEM, dynamicPrompt, 'COMPACT PASS-1 REQUEST');
  }
}
