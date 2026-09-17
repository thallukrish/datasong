import { CallPathIndexerV2 } from './callPathIndexerV2.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function weight(profile, name) {
  const value = Number(profile?.weights?.[name]);
  return Number.isFinite(value) ? value : 0;
}
function valueAtPath(object, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let current = object;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

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
  priorityProfile() {
    if (typeof this.topology?.callPathPriorityProfile !== 'function') return null;
    const profile = this.topology.callPathPriorityProfile();
    return profile?.weights && typeof profile.weights === 'object' ? profile : null;
  }

  isPriorityExcluded(symbols, profile) {
    for (const rule of arr(profile?.excludeWhen)) {
      const values = new Set(arr(rule?.values).map((value) => String(value)));
      if (!rule?.path || !values.size) continue;
      if (symbols.some((symbol) => values.has(String(valueAtPath(symbol, rule.path) ?? '')))) return true;
    }
    return false;
  }

  firstClassNodeIdentities(symbols, profile) {
    const config = profile?.firstClassNodes;
    if (!config?.metadataPath || !config?.identityField) return [];
    const identities = new Set();
    for (const symbol of symbols) {
      const metadata = valueAtPath(symbol, config.metadataPath);
      if (!metadata || typeof metadata !== 'object') continue;
      const flags = arr(config.flags);
      const isFirstClass = flags.length
        ? flags.some((flag) => metadata?.[flag] === true)
        : metadata?.firstClass === true;
      if (!isFirstClass) continue;
      const identity = String(metadata?.[config.identityField] || '').trim();
      if (identity) identities.add(identity);
    }
    return [...identities].sort();
  }

  pathStructuralPriority(path, profile) {
    const symbols = arr(path?.symbolIds)
      .map((id) => this.topology?.symbolById?.get?.(id))
      .filter(Boolean);
    const firstClassNodes = this.firstClassNodeIdentities(symbols, profile);
    const excluded = this.isPriorityExcluded(symbols, profile);
    let crossEntityBoundaryCount = 0;
    let persistenceWriteCount = 0;
    let persistenceReadCount = 0;
    let sqlPersistenceCount = 0;

    // Count framework/entity handoffs only when the reference is the actual
    // executable edge used by this path. This avoids giving a path credit for
    // unrelated branches hanging off one of its symbols.
    for (let i = 0; i < symbols.length - 1; i += 1) {
      const source = symbols[i];
      const target = symbols[i + 1];
      const ref = arr(source?.references).find((candidate) =>
        this.executableRelations.has(String(candidate?.relation || ''))
        && String(candidate?.name || '') === String(target?.name || ''));
      const data = ref?.data || {};
      const sourceEntity = String(data.sourceModel || data.sourceEntity || '');
      const targetEntity = String(data.targetModel || data.targetEntity || '');
      if (sourceEntity && targetEntity && sourceEntity !== targetEntity) crossEntityBoundaryCount += 1;
    }

    // Persistence is supporting evidence only. It must not create first-class
    // node credit; first-class credit comes from configured path nodes actually
    // traversed by the executable path.
    for (const symbol of symbols) {
      for (const ref of arr(symbol?.references)) {
        const data = ref?.data || {};
        const relation = String(ref?.relation || '');
        const persistenceKind = String(data.persistenceKind || '');
        const persistence = ['reads', 'writes'].includes(relation)
          && (persistenceKind || String(data.operationKind || '') === 'persistence');
        if (!persistence) continue;
        if (relation === 'writes') persistenceWriteCount += 1;
        else persistenceReadCount += 1;
        if (persistenceKind === 'sql') sqlPersistenceCount += 1;
      }
    }

    const executableRelationCount = arr(path?.relations)
      .filter((relation) => this.executableRelations.has(String(relation || ''))).length;
    const functionCount = Number(path?.functionCount || symbols.length || 0);
    const isolated = functionCount <= 1
      && firstClassNodes.length === 0
      && persistenceWriteCount + persistenceReadCount === 0
      && executableRelationCount === 0;

    const normalScore = firstClassNodes.length * weight(profile, 'firstClassNode')
      + crossEntityBoundaryCount * weight(profile, 'crossEntityBoundary')
      + persistenceWriteCount * weight(profile, 'persistenceWrite')
      + persistenceReadCount * weight(profile, 'persistenceRead')
      + sqlPersistenceCount * weight(profile, 'sqlPersistence')
      + executableRelationCount * weight(profile, 'executableRelation')
      + functionCount * weight(profile, 'function')
      + (isolated ? weight(profile, 'isolatedNoEntityNoPersistence') : 0);
    const excludedScore = Number(profile?.excludedPriorityScore);
    const score = excluded && Number.isFinite(excludedScore) ? excludedScore : normalScore;

    return {
      score,
      evidence: {
        profileVersion: String(profile?.version || ''),
        firstClassNodeCount: firstClassNodes.length,
        firstClassNodes,
        crossEntityBoundaryCount,
        persistenceWriteCount,
        persistenceReadCount,
        sqlPersistenceCount,
        executableRelationCount,
        functionCount,
        isolatedNoEntityNoPersistence: isolated,
        excludedFromPriority: excluded
      }
    };
  }

  orderedPaths() {
    const profile = this.priorityProfile();
    if (!profile) return { paths: this.rankedPaths, priorityById: new Map() };
    const scored = this.rankedPaths.map((path, index) => ({
      path,
      index,
      priority: this.pathStructuralPriority(path, profile)
    }));
    scored.sort((a, b) => b.priority.score - a.priority.score || a.index - b.index);
    return {
      paths: scored.map((item) => item.path),
      priorityById: new Map(scored.map((item) => [item.path.id, item.priority]))
    };
  }

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
    const { paths, priorityById } = this.orderedPaths();

    for (const path of paths) {
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
          symbolIds: arr(path.symbolIds),
          sourcePaths: arr(path.sourcePaths),
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
      const structuralPriority = priorityById.get(representative.id);

      return {
        ...representative,
        ...(structuralPriority ? {
          structuralPriority: structuralPriority.score,
          structuralPriorityEvidence: structuralPriority.evidence
        } : {}),
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
      version: 8,
      fragmentCount: this.fragments.length,
      rawPathCount: this.rawPaths.length,
      rankedPathCount: this.rankedPaths.length,
      groupedPathCount: this.top(Number.MAX_SAFE_INTEGER).length,
      fragments: this.fragments,
      topPaths: this.top(10).map((path) => ({ ...path, rendered: this.render(path) }))
    };
  }
}
