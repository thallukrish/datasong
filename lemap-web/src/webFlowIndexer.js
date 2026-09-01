function arr(value) { return Array.isArray(value) ? value : []; }
function sameSequence(a, b) { return a.length === b.length && a.every((v, i) => v === b[i]); }
function isPrefix(shorter, longer) { return shorter.length <= longer.length && shorter.every((v, i) => v === longer[i]); }
function commonPrefixLength(a, b) {
  let i = 0;
  const max = Math.min(a.length, b.length);
  while (i < max && a[i] === b[i]) i += 1;
  return i;
}

function effectiveLength(tokens) {
  let count = 0;
  let previous = null;
  for (const token of tokens) {
    if (token === previous) continue;
    previous = token;
    if (token.startsWith('function:')) count += 0.25;
    else if (token.startsWith('network:')) count += 0.75;
    else count += 1;
  }
  return count;
}

export class WebFlowIndexer {
  constructor() {
    this.paths = [];
  }

  addPath(path) {
    this.paths.push({
      id: String(path.id),
      tokens: arr(path.tokens || path.normalizedFlowTokens).map(String)
    });
    return this;
  }

  rank() {
    const duplicateCanonical = [];
    const duplicateMap = new Map();

    for (const path of this.paths) {
      const existing = duplicateCanonical.find((candidate) => sameSequence(candidate.tokens, path.tokens));
      if (existing) {
        if (!duplicateMap.has(existing.id)) duplicateMap.set(existing.id, []);
        duplicateMap.get(existing.id).push(path.id);
      } else {
        duplicateCanonical.push(path);
      }
    }

    const containedBy = new Map();
    for (const path of duplicateCanonical) {
      const containers = duplicateCanonical.filter((candidate) => candidate !== path && isPrefix(path.tokens, candidate.tokens));
      if (containers.length) {
        containers.sort((a, b) => b.tokens.length - a.tokens.length);
        containedBy.set(path.id, containers[0].id);
      }
    }

    const maximal = duplicateCanonical.filter((path) => !containedBy.has(path.id));
    const result = maximal.map((path) => {
      const containedPathIds = [];
      for (const candidate of duplicateCanonical) {
        if (candidate.id === path.id) continue;
        if (isPrefix(candidate.tokens, path.tokens)) {
          containedPathIds.push(candidate.id, ...arr(duplicateMap.get(candidate.id)));
        }
      }

      const branchVariants = [];
      for (const candidate of duplicateCanonical) {
        if (candidate.id === path.id || containedPathIds.includes(candidate.id)) continue;
        const prefix = commonPrefixLength(path.tokens, candidate.tokens);
        const shorter = Math.min(path.tokens.length, candidate.tokens.length);
        if (prefix >= 2 && prefix / shorter > 0.5) {
          branchVariants.push({
            id: candidate.id,
            commonPrefix: path.tokens.slice(0, prefix),
            tokens: candidate.tokens
          });
        }
      }

      return {
        id: path.id,
        tokens: path.tokens,
        effectiveLength: effectiveLength(path.tokens),
        duplicateCount: arr(duplicateMap.get(path.id)).length + [...new Set(containedPathIds)].reduce((sum, id) => sum + arr(duplicateMap.get(id)).length, 0),
        duplicatePathIds: arr(duplicateMap.get(path.id)),
        containedPathIds: [...new Set(containedPathIds)],
        branchVariants
      };
    });

    result.sort((a, b) => b.effectiveLength - a.effectiveLength || b.tokens.length - a.tokens.length || a.id.localeCompare(b.id));
    return result;
  }
}
