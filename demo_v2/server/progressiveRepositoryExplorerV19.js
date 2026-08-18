import { ProgressiveRepositoryExplorerV18 } from './progressiveRepositoryExplorerV18.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function norm(value) { return String(value || '').trim().toLowerCase(); }

export class ProgressiveRepositoryExplorerV19 extends ProgressiveRepositoryExplorerV18 {
  storyIdForReference(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const exactId = this.state.stories.find((story) => story.id === raw);
    if (exactId) return exactId.id;
    const byTitle = this.state.stories.find((story) => norm(story.title) === norm(raw));
    return byTitle?.id || null;
  }

  isPass1ArcReference(value) {
    const key = norm(value);
    if (!key) return false;
    if (typeof this.activeArcTitle === 'function' && norm(this.activeArcTitle()) === key) return true;
    if (arr(this.state.pass1Arcs).some((arc) => norm(arc?.title) === key)) return true;
    return arr(this.state.pass1ArcSeeds).some((seed) => norm(seed?.title) === key);
  }

  normalizeThreadReference(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === 'NEW' || raw === 'UNATTACHED') return raw;
    const storyId = this.storyIdForReference(raw);
    if (storyId) return storyId;
    if (this.isPass1ArcReference(raw)) return 'UNATTACHED';
    return raw;
  }

  normalizeThreadReferences(parsed) {
    if (!parsed || typeof parsed !== 'object') return parsed;

    if (Object.prototype.hasOwnProperty.call(parsed, 'bestThread')) {
      const original = parsed.bestThread;
      parsed.bestThread = this.normalizeThreadReference(parsed.bestThread);
      if (parsed.bestThread === 'UNATTACHED' && this.isPass1ArcReference(original)) {
        parsed.newThread = null;
        // Durable-thread placement is intentionally unattached while Pass 1's
        // independent business-arc board continues to accumulate the evidence.
        if (parsed.relation === 'new_thread') parsed.relation = 'unattached';
        parsed._normalizedPass1ArcThreadReference = String(original || '');
      }
    }

    parsed.threadFits = arr(parsed.threadFits).map((fit) => {
      if (!fit || typeof fit !== 'object') return fit;
      const mapped = this.normalizeThreadReference(fit.threadId);
      return { ...fit, threadId: mapped };
    });

    parsed.candidateScores = arr(parsed.candidateScores).map((score) => {
      if (!score || typeof score !== 'object') return score;
      return { ...score, threadId: this.normalizeThreadReference(score.threadId) };
    });

    return parsed;
  }

  parseModelOutput(raw) {
    return this.normalizeThreadReferences(super.parseModelOutput(raw));
  }

  buildPrompt(observation, candidates) {
    const prompt = super.buildPrompt(observation, candidates);
    if (!['semantic_function', 'xml_file', 'config_file', 'text_file', 'semantic_neighborhood'].includes(observation?.kind)) return prompt;
    return `${prompt}\nTHREAD-ID RULE: ARC titles are Pass-1 state, not durable thread IDs. bestThread/threadId must use a supplied THREAD id, NEW, or UNATTACHED.`;
  }
}
