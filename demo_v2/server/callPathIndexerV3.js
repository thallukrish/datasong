import { CallPathIndexerV2 } from './callPathIndexerV2.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function commonPrefixLength(a, b) {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function commonSuffixLength(a, b, prefixLength = 0) {
  const max = Math.min(a.length, b.length) - prefixLength;
  let i = 0;
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i += 1;
  return i;
}

function sameSequence(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export class CallPathIndexerV3 extends CallPathIndexerV2 {
  overlapShape(a, b) {
    const aa = arr(a?.normalizedFlowTokens);
    const bb = arr(b?.normalizedFlowTokens);
    const shorter = Math.min(aa.length, bb.length);
    if (!shorter) return { relation: 'independent', overlapRatio: 0 };

    if (sameSequence(aa, bb)) {
      return {
        relation: 'duplicate', overlapRatio: 1,
        prefixLength: aa.length, suffixLength: 0,
        aPrefix: [], bPrefix: [], aMiddle: [], bMiddle: [], commonSuffix: []
      };
    }

    const prefixLength = commonPrefixLength(aa, bb);
    const suffixLength = commonSuffixLength(aa, bb, prefixLength);
    const prefixRatio = prefixLength / shorter;
    const suffixRatio = suffixLength / shorter;

    const aPrefix = aa.slice(0, Math.max(0, aa.length - suffixLength));
    const bPrefix = bb.slice(0, Math.max(0, bb.length - suffixLength));
    const aMiddle = aa.slice(prefixLength, aa.length - suffixLength || aa.length);
    const bMiddle = bb.slice(prefixLength, bb.length - suffixLength || bb.length);
    const commonSuffix = suffixLength ? aa.slice(aa.length - suffixLength) : [];

    if (prefixLength >= 2 && prefixRatio > 0.5) {
      return {
        relation: 'branch', overlapRatio: prefixRatio,
        prefixLength, suffixLength,
        commonPrefix: aa.slice(0, prefixLength),
        aMiddle, bMiddle, commonSuffix
      };
    }

    if (suffixLength >= 2 && suffixRatio > 0.5) {
      const aEntranceLength = aa.length - suffixLength;
      const bEntranceLength = bb.length - suffixLength;
      if (aEntranceLength <= 2 && bEntranceLength <= 2) {
        return {
          relation: 'alternate_entrance', overlapRatio: suffixRatio,
          prefixLength, suffixLength,
          aEntrance: aa.slice(0, aEntranceLength),
          bEntrance: bb.slice(0, bEntranceLength),
          commonSuffix
        };
      }
      return {
        relation: 'shared_subflow', overlapRatio: suffixRatio,
        prefixLength, suffixLength,
        aPrefix, bPrefix, commonSuffix
      };
    }

    return {
      relation: 'independent',
      overlapRatio: Math.max(prefixRatio, suffixRatio),
      prefixLength, suffixLength
    };
  }

  mergeableRelation(relation) {
    return relation === 'duplicate' || relation === 'branch' || relation === 'alternate_entrance';
  }

  top(limit = 10) {
    const groups = [];
    const sharedSubflows = [];

    for (const path of this.rankedPaths) {
      let chosen = null;
      let chosenShape = null;
      for (const group of groups) {
        for (const member of group.members) {
          const shape = this.overlapShape(member, path);
          if (shape.relation === 'shared_subflow') {
            sharedSubflows.push({
              from: member.id,
              to: path.id,
              ...shape,
              // Public/exported name makes the relationship explicit while
              // preserving commonSuffix as the internal overlap descriptor.
              sharedSuffix: arr(shape.commonSuffix)
            });
            continue;
          }
          if (this.mergeableRelation(shape.relation)) {
            chosen = group;
            chosenShape = shape;
            break;
          }
        }
        if (chosen) break;
      }

      if (!chosen) {
        groups.push({ members: [path], relations: [] });
      } else {
        chosen.members.push(path);
        chosen.relations.push({ pathId: path.id, ...chosenShape });
      }
    }

    return groups.map((group) => {
      const representative = group.members[0];
      const alternatives = group.members.slice(1).map((path) => {
        const shape = this.overlapShape(representative, path);
        return {
          pathId: path.id,
          functionCount: path.functionCount,
          signatures: path.signatures,
          normalizedFlowTokens: path.normalizedFlowTokens,
          relations: path.relations,
          terminal: path.terminal,
          familyRelation: shape.relation,
          overlapRatio: shape.overlapRatio,
          overlapShape: shape
        };
      });

      const branchShapes = alternatives
        .filter((item) => item.familyRelation === 'branch')
        .map((item) => item.overlapShape);
      const mergedStructure = branchShapes.length ? {
        commonPrefix: branchShapes[0].commonPrefix || [],
        branches: branchShapes.flatMap((shape) => [shape.aMiddle || [], shape.bMiddle || []])
          .filter((branch, index, all) => branch.length && all.findIndex((other) => sameSequence(other, branch)) === index),
        commonSuffix: branchShapes[0].commonSuffix || []
      } : null;

      return {
        ...representative,
        branchVariantCount: 1 + alternatives.filter((item) => item.familyRelation === 'branch').length,
        alternateEntranceCount: alternatives.filter((item) => item.familyRelation === 'alternate_entrance').length,
        duplicateVariantCount: alternatives.filter((item) => item.familyRelation === 'duplicate').length,
        alternatives,
        mergedStructure,
        sharedSubflowRefs: sharedSubflows.filter((ref) => ref.from === representative.id || ref.to === representative.id)
      };
    }).slice(0, Math.max(0, Number(limit) || 0));
  }

  snapshot() {
    return {
      version: 6,
      fragmentCount: this.fragments.length,
      rawPathCount: this.rawPaths.length,
      rankedPathCount: this.rankedPaths.length,
      groupedPathCount: this.top(Number.MAX_SAFE_INTEGER).length,
      fragments: this.fragments,
      topPaths: this.top(10).map((path) => ({ ...path, rendered: this.render(path) }))
    };
  }
}
