import { activeScore } from './pathScore.js';

export class Frontier {
  constructor() { this.items = []; }

  add(paths = []) {
    for (const path of paths) {
      const signature = path.states.map((state) => state.id).join('>');
      if (this.items.some((item) => item.signature === signature)) continue;
      this.items.push({ ...path, signature });
    }
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
    return [...this.items]
      .sort((a, b) => activeScore(b.score, missingDimensions) - activeScore(a.score, missingDimensions))
      .slice(0, limit)
      .map((path) => ({
        path:path.states.map((state) => state.name),
        score:path.score,
        priority:activeScore(path.score, missingDimensions)
      }));
  }

  get size() { return this.items.length; }
}
