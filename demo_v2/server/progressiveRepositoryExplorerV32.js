import { ProgressiveRepositoryExplorerV31 } from './progressiveRepositoryExplorerV31.js';

function arr(value) { return Array.isArray(value) ? value : []; }

export class ProgressiveRepositoryExplorerV32 extends ProgressiveRepositoryExplorerV31 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'parallel-callpath-overlap-shape-v14';
    return state;
  }

  compactCallPath(path) {
    const alternatives = arr(path?.alternatives);
    const branches = alternatives.filter((alt) => alt.familyRelation === 'branch');
    const entrances = alternatives.filter((alt) => alt.familyRelation === 'alternate_entrance');
    const duplicates = alternatives.filter((alt) => alt.familyRelation === 'duplicate');

    return {
      pathId: path.id,
      functionCount: path.functionCount,
      branchVariantCount: Number(path.branchVariantCount || 1),
      alternateEntranceCount: Number(path.alternateEntranceCount || entrances.length || 0),
      duplicateVariantCount: Number(path.duplicateVariantCount || duplicates.length || 0),
      rendered: path.rendered,
      mergedStructure: path.mergedStructure || null,
      branchSummary: branches.slice(0, 8).map((alt) => ({
        pathId: alt.pathId,
        overlapRatio: alt.overlapRatio,
        branchMiddle: alt.overlapShape?.bMiddle || [],
        commonSuffix: alt.overlapShape?.commonSuffix || [],
        terminal: alt.terminal?.type || 'end'
      })),
      alternateEntrances: entrances.slice(0, 6).map((alt) => ({
        pathId: alt.pathId,
        overlapRatio: alt.overlapRatio,
        differingEntrance: alt.overlapShape?.bEntrance || []
      })),
      sharedSubflowRefs: arr(path.sharedSubflowRefs).slice(0, 6).map((ref) => ({
        otherPathId: ref.from === path.id ? ref.to : ref.from,
        overlapRatio: ref.overlapRatio,
        sharedSuffix: ref.commonSuffix || []
      })),
      terminal: path.terminal?.type === 'external'
        ? { type: 'external', calls: arr(path.terminal.calls).map((call) => ({ relation: call.relation, name: call.name })) }
        : path.terminal?.type === 'cycle'
          ? { type: 'cycle' }
          : { type: 'end' }
    };
  }
}
