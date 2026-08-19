import { ProgressiveRepositoryExplorerV31 } from './progressiveRepositoryExplorerV31.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ProgressiveRepositoryExplorerV32 extends ProgressiveRepositoryExplorerV31 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-prellm-entrance-dedupe-v12';
    return state;
  }

  compactCallPath(path) {
    const alternatives = arr(path?.alternatives);
    const branches = alternatives.filter((alt) => alt.familyRelation !== 'alternate_entrance');
    const entrances = alternatives.filter((alt) => alt.familyRelation === 'alternate_entrance');

    return {
      pathId: path.id,
      functionCount: path.functionCount,
      branchVariantCount: Number(path.branchVariantCount || 1),
      alternateEntranceCount: Number(path.alternateEntranceCount || entrances.length || 0),
      rendered: path.rendered,
      branchSummary: branches.slice(0, 8).map((alt) => ({
        pathId: alt.pathId,
        functionCount: alt.functionCount,
        terminal: alt.terminal?.type || 'end',
        divergentTail: arr(alt.signatures).slice(-3)
      })),
      alternateEntrances: entrances.slice(0, 6).map((alt) => {
        const sharedSuffix = this.commonSignatureSuffixLength(arr(path.signatures), arr(alt.signatures));
        return {
          pathId: alt.pathId,
          differingPrefix: arr(alt.signatures).slice(0, Math.max(0, arr(alt.signatures).length - sharedSuffix))
        };
      }),
      terminal: path.terminal?.type === 'external'
        ? { type: 'external', calls: arr(path.terminal.calls).map((call) => ({ relation: call.relation, name: call.name })) }
        : path.terminal?.type === 'cycle'
          ? { type: 'cycle' }
          : { type: 'end' }
    };
  }

  commonSignatureSuffixLength(a, b) {
    const max = Math.min(a.length, b.length);
    let i = 0;
    while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
    return i;
  }
}
