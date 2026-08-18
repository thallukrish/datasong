import { ProgressiveRepositoryTopologyV4 } from './progressiveRepositoryTopologyV4.js';

function words(value = '') {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function contiguousIndex(target, query) {
  if (!query.length || query.length > target.length) return -1;
  outer: for (let i = 0; i <= target.length - query.length; i += 1) {
    for (let j = 0; j < query.length; j += 1) {
      if (target[i + j] !== query[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function orderedMatchCount(target, query) {
  let q = 0;
  for (const token of target) {
    if (q < query.length && token === query[q]) q += 1;
  }
  return q;
}

function lexicalMatch(targetWords, queryWords) {
  if (!queryWords.length || !targetWords.length) return null;

  const contiguousAt = contiguousIndex(targetWords, queryWords);
  const exact = targetWords.length === queryWords.length && contiguousAt === 0;
  const prefix = !exact && contiguousAt === 0;
  const contiguous = contiguousAt > 0;
  const orderedCount = orderedMatchCount(targetWords, queryWords);
  const allOrdered = orderedCount === queryWords.length;

  // Deterministic tiers, highest first:
  // 5 exact target phrase
  // 4 all words contiguous from the beginning of the target
  // 3 all words contiguous, but starting later in the target
  // 2 all words present in order, with intervening words
  // 1 only part of the requested words present in order
  if (exact) return { tier: 5, matchedWords: queryWords.length, start: 0, label: 'exact' };
  if (prefix) return { tier: 4, matchedWords: queryWords.length, start: 0, label: 'prefix_phrase' };
  if (contiguous) return { tier: 3, matchedWords: queryWords.length, start: contiguousAt, label: 'substring_phrase' };
  if (allOrdered) return { tier: 2, matchedWords: queryWords.length, start: -1, label: 'all_words_in_order' };
  if (orderedCount > 0) return { tier: 1, matchedWords: orderedCount, start: -1, label: 'partial_words_in_order' };
  return null;
}

function symbolSearchTexts(symbol, packet) {
  const fields = [
    symbol?.name,
    symbol?.simpleName,
    symbol?.signature,
    symbol?.sourcePath,
    packet?.function,
    packet?.kind,
    ...(Array.isArray(packet?.operations) ? packet.operations : []),
    ...(Array.isArray(packet?.conditions) ? packet.conditions : []),
    ...(Array.isArray(packet?.inputs) ? packet.inputs : []),
    ...(Array.isArray(packet?.outputs) ? packet.outputs : [])
  ];
  return fields.map((field) => words(typeof field === 'string' ? field : JSON.stringify(field || ''))).filter((tokens) => tokens.length);
}

export class ProgressiveRepositoryTopologyV5 extends ProgressiveRepositoryTopologyV4 {
  async searchSemantic(query) {
    const queryWords = words(query);
    if (!queryWords.length) return [];

    const ranked = [];
    for (const symbol of this.symbols) {
      const packet = this.canonicalPacket(symbol);
      let best = null;
      for (const targetWords of symbolSearchTexts(symbol, packet)) {
        const match = lexicalMatch(targetWords, queryWords);
        if (!match) continue;
        if (!best
          || match.tier > best.tier
          || (match.tier === best.tier && match.matchedWords > best.matchedWords)
          || (match.tier === best.tier && match.matchedWords === best.matchedWords && match.start >= 0 && (best.start < 0 || match.start < best.start))) {
          best = match;
        }
      }
      if (best) ranked.push({ symbol, ...best });
    }

    return ranked
      .sort((a, b) =>
        b.tier - a.tier
        || b.matchedWords - a.matchedWords
        || ((a.start < 0 ? Number.MAX_SAFE_INTEGER : a.start) - (b.start < 0 ? Number.MAX_SAFE_INTEGER : b.start))
        || String(a.symbol?.name || '').localeCompare(String(b.symbol?.name || '')))
      .slice(0, 12)
      .map(({ symbol, tier, matchedWords, label }) => {
        const candidate = this.canonicalCandidate(this.describeCandidate(
          symbol,
          'search',
          `word search ${label}; matched ${matchedWords}/${queryWords.length} words; tier ${tier}`
        ));
        candidate.searchMatch = { type: label, tier, matchedWords, queryWords: queryWords.length };
        return candidate;
      });
  }

  // Keep callers of the older search() path aligned with the same deterministic
  // word-level policy rather than falling back to substring term counting.
  async search(query) {
    return this.searchSemantic(query);
  }
}
