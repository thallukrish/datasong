import { ProgressiveRepositoryExplorerV26 } from './progressiveRepositoryExplorerV26.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export class ProgressiveRepositoryExplorerV27 extends ProgressiveRepositoryExplorerV26 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'scout-discovery-concrete-usecase-pass1-pass2-v7';
    return state;
  }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (!this.discoveryActive() || !this.discoveryMode(observation)) return base;
    return `${base}\n\nCONCRETE BUSINESS-USE-CASE QUALIFICATION:\nA Discovery start may qualify only when the evidence supports ONE traceable actor goal with a recognizable completion condition/business effect. A UI area, screen hierarchy, navigation structure, widget set, menu, broad functional domain, or generic \"management\" area is NOT by itself a business use case. Keep such evidence as a candidate entrance and go one level deeper until a concrete actor goal appears.\nFor currentPathAssessment and every candidateDiscoveryScores entry also return:\n- isConcreteBusinessUseCase: true|false\n- completionCondition: what observable event/state means this actor goal has completed\n- businessOutcome: the business/user effect produced when it completes\nOnly set qualifiesAsBusinessUseCase=true when isConcreteBusinessUseCase=true AND businessActor, businessIntent, completionCondition and businessOutcome are all evidenced.\nExamples of NOT sufficient: \"Storefront navigation\", \"main widgets\", \"Admin back-office management\".\nExamples of potentially sufficient when evidenced: \"Customer searches for a product and sees matching results\", \"Operator releases an order for fulfillment\", \"Accounting clerk applies a payment to an invoice\".`;
  }

  normalizeDiscovery(raw, candidates) {
    const out = super.normalizeDiscovery(raw, candidates);
    const rawAssessment = raw?.currentPathAssessment || {};
    out.currentPathAssessment.isConcreteBusinessUseCase = rawAssessment?.isConcreteBusinessUseCase === true;
    out.currentPathAssessment.completionCondition = text(rawAssessment?.completionCondition, 300);
    out.currentPathAssessment.businessOutcome = text(rawAssessment?.businessOutcome, 320);
    out.currentPathAssessment.qualifiesAsBusinessUseCase = this.concreteQualification(out.currentPathAssessment);

    const rawScores = new Map(arr(raw?.candidateDiscoveryScores).map((item) => [item?.artifactId, item]));
    out.candidateDiscoveryScores = arr(out.candidateDiscoveryScores).map((score) => {
      const source = rawScores.get(score.artifactId) || {};
      const enriched = {
        ...score,
        isConcreteBusinessUseCase: source?.isConcreteBusinessUseCase === true,
        completionCondition: text(source?.completionCondition, 300),
        businessOutcome: text(source?.businessOutcome, 320)
      };
      enriched.qualifiesAsBusinessUseCase = this.concreteQualification(enriched);
      return enriched;
    });
    return out;
  }

  concreteQualification(item) {
    return item?.qualifiesAsBusinessUseCase === true
      && item?.isConcreteBusinessUseCase === true
      && !!text(item?.businessActor, 220)
      && !!text(item?.businessIntent, 280)
      && !!text(item?.completionCondition, 300)
      && !!text(item?.businessOutcome, 320);
  }

  unresolvedScoutStarts() {
    const ids = new Set(arr(this.state.scout?.discoveredStartIds));
    return this.discovery().starts().filter((start) => ids.has(start.id) && start.status === 'candidate');
  }

  newlyQualifiedScoutStarts() {
    const promoted = new Set(this.pass1().arcs().map((arc) => arc.discoveryStartId).filter(Boolean));
    const ids = new Set(arr(this.state.scout?.discoveredStartIds));
    return this.discovery().starts().filter((start) => ids.has(start.id) && start.status === 'qualified' && !promoted.has(start.id));
  }

  applyDelta(parsed, observation) {
    const result = super.applyDelta(parsed, observation);
    if (!parsed?._discovery || !this.discoveryActive()) return result;

    // Scout-reopened Discovery has a bounded semantic job: resolve the starts
    // Scout introduced. Once every Scout seed is either qualified or
    // deprioritized, return immediately to Pass 1/Pass 2 instead of walking
    // miscellaneous repository files waiting for the model to say complete.
    const scoutIds = arr(this.state.scout?.discoveredStartIds);
    if (this.pass1().arcs().length && scoutIds.length && this.unresolvedScoutStarts().length === 0) {
      const qualified = this.newlyQualifiedScoutStarts();
      this.discovery().ensureState().status = 'complete';
      this.discovery().ensureState().activeStartId = '';
      this._discoveryChosen = null;
      if (qualified.length) this.seedQualifiedArcs(qualified);
      else this.pass1().syncStories();
      this.state.scout.discoveredStartIds = [];
      this.state.lastMessage = qualified.length
        ? `Scout Discovery qualified ${qualified.length} new concrete business-use-case entrance${qualified.length === 1 ? '' : 's'}; returning to Pass 1.`
        : 'Scout Discovery found no additional concrete business-use-case entrance; returning to Pass 1.';
    }
    return result;
  }
}
