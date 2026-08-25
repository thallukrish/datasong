import { activeScore } from './pathScore.js';

export class Frontier {
  constructor() { this.items = []; this.dormant = []; }

  add(paths = []) {
    for (const path of paths) {
      const signature = path.states.map((state) => state.id).join('>');
      if (this.items.some((item) => item.signature === signature) || this.dormant.some((item) => item.signature === signature)) continue;
      this.items.push({ ...path, signature });
    }
  }

  addDormant(parentPath, states = []) {
    for (const state of states) {
      const path = { states:[...(parentPath?.states || []), state], score:null, deltas:[...(parentPath?.deltas || [])], joins:[...(parentPath?.joins || [])], parentPath };
      const signature = path.states.map((item) => item.id).join('>');
      if (this.items.some((item) => item.signature === signature) || this.dormant.some((item) => item.signature === signature)) continue;
      this.dormant.push({ ...path, signature });
    }
  }

  takeDormant(limit = 8) {
    return this.dormant.splice(0, Math.max(1, limit));
  }

  popBest(missingDimensions = []) {
    if (!this.items.length) return null;
    this.items.sort((a, b) => activeScore(b.score, missingDimensions) - activeScore(a.score, missingDimensions));
    return this.items.shift() || null;
  }

  peekBest(missingDimensions = []) {
    if (!this.items.length) return null;
    return [...this.items].sort((a, b) => activeScore(b.score, missingDimensions) - activeScore(a.score, missingDimensions))[0] || null;
  }

  snapshot(missingDimensions = [], limit = 20) {
    return {
      scored:[...this.items]
        .sort((a, b) => activeScore(b.score, missingDimensions) - activeScore(a.score, missingDimensions))
        .slice(0, limit)
        .map((path) => ({ path:path.states.map((state) => state.name), score:path.score, priority:activeScore(path.score, missingDimensions) })),
      dormant:this.dormant.slice(0, limit).map((path) => ({ path:path.states.map((state) => state.name) }))
    };
  }

  get size() { return this.items.length; }
  get dormantSize() { return this.dormant.length; }
}
