const arr = (value) => Array.isArray(value) ? value : [];
const text = (value, max = 240) => {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const uniq = (values) => [...new Set(arr(values).map((v) => text(v)).filter(Boolean))];

export const withBusinessMapAccumulation = (Base) => class BusinessMapAccumulationExplorer extends Base {
  emptyState() {
    const state = super.emptyState();
    if (state.discovery) {
      state.discovery.status = 'disabled';
      state.discovery.activeStartId = '';
    }
    return state;
  }

  discoveryActive() { return false; }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (!this.semanticMode?.(observation) || String(base || '').startsWith('MODE call-path-business-seed-classification')) return base;
    return `${base}\nMAP ACCUMULATION: when CURRENT evidence reveals durable business state, add arcUpdate.persistentObjects as an array of named persisted records/entities/documents. When it reveals an externally visible side effect, add arcUpdate.externalEffects as an array. Do not infer either without evidence.`;
  }

  normalizePass12(raw, candidates) {
    const out = super.normalizePass12(raw, candidates);
    const update = raw?.arcUpdate && typeof raw.arcUpdate === 'object' ? raw.arcUpdate : {};
    out.arcUpdate.persistentObjects = uniq(update.persistentObjects);
    out.arcUpdate.externalEffects = uniq(update.externalEffects);
    return out;
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (!parsed?._pass12) return result;
    const update = parsed.arcUpdate || {};
    const arc = this.pass1().arcByReference(update.arcId) || this.pass1().activeArc();
    if (arc) {
      arc.persistentObjects = uniq([...arr(arc.persistentObjects), ...arr(update.persistentObjects)]);
      arc.externalEffects = uniq([...arr(arc.externalEffects), ...arr(update.externalEffects)]);
      this.pass1().syncStories();
    }
    return result;
  }
};
