import { ProgressiveRepositoryExplorerV10 } from './progressiveRepositoryExplorerV10.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 500) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function uniq(values) { return [...new Set(arr(values).map((v) => text(v, 220)).filter(Boolean))]; }

const PASS1_OBJECTIVE = `PASS 1 — BROAD BUSINESS-ARC DISCOVERY

Your job in this pass is NOT code inspection and NOT exhaustive repository coverage.
Discover the broad end-to-end business use cases implemented by the system.

For each business arc, seek only the pieces needed to explain the business vertical slice:
- trigger / business intent / actor;
- major business stages;
- important business decisions or branches;
- major data effects;
- major persistent/business entities and their relationships;
- end state, persistence effect, external handoff, or user-visible outcome.

A broad arc may be considered sufficiently understood for Pass 1 when its trigger, coherent major stages, and business outcome are visible and the important entities/relationships are known well enough to explain the slice. Do not keep drilling merely to account for every helper, mapper, formatter, validator, test hook, framework callback, field, DTO, or implementation edge.

TRIVIAL FOR PASS 1 means: omitting the internal detail does not materially change the explanation of the business intent, major stages, business decisions, major data transformations/effects, persistent entities/relationships, actors, or outcome. Collapse such evidence into a short business-level statement or skip it.

Examples:
- normalizePhoneNumber() may collapse into “validate/normalize customer contact data”.
- a chain of mappers/loggers/helpers may be skipped if it does not change the business story.
- payment rejection, inventory failure, approval decision, order persistence, or an external handoff is NOT trivial because it changes the business arc.

When several distinct business arcs are visible, identify ALL promising arc seeds. Do not spend the whole pass deepening only the first arc. Prefer completing a nearly coherent broad arc when useful, but once it is broadly complete, move to another promising arc rather than descending into implementation detail.

Later passes may reopen any discovered arc and resolve details intentionally omitted here.`;

const PASS1_RETURN = `PASS-1 RETURN FIELDS
Also return these fields in addition to the existing contract:
{
  "pass1": {
    "evidenceRole": "major|supporting|trivial",
    "collapsedMeaning": "short business-level meaning; required when supporting/trivial",
    "arc": {
      "title": "business-use-case title or empty",
      "trigger": "actor/business intent or empty",
      "majorStages": ["broad stage"],
      "outcome": "business/persistence/external outcome or empty",
      "entities": ["major business/persistent entity"],
      "relationships": ["Entity A -> relationship -> Entity B"],
      "status": "forming|broadly_complete|not_a_business_arc"
    },
    "arcSeeds": [
      {"title":"other distinct business use case visible in this evidence","trigger":"optional","outcome":"optional","reason":"why it is a promising separate arc"}
    ]
  }
}
Rules:
- evidenceRole=major only when this evidence materially adds/changes a broad business stage, decision, entity relationship, trigger, or outcome.
- evidenceRole=supporting when useful but compressible into the broader stage.
- evidenceRole=trivial when its internal detail can be omitted without changing Pass-1 understanding.
- status=broadly_complete is about BROAD semantic understanding, not implementation completeness.
- arcSeeds are distinct business use cases, not helper functions or technical subsystems.`;

export class ProgressiveRepositoryExplorerV11 extends ProgressiveRepositoryExplorerV10 {
  emptyState() {
    const state = super.emptyState();
    state.pass = 1;
    state.pass1Arcs = [];
    state.pass1ArcSeeds = [];
    state.pass1CollapsedEvidence = [];
    state.pass1ArcSwitches = [];
    return state;
  }

  pass1Board() {
    return {
      arcs: this.state.pass1Arcs.slice(-12),
      pendingArcSeeds: this.state.pass1ArcSeeds.filter((seed) => seed.status === 'pending').slice(0, 12)
    };
  }

  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    const semantic = ['semantic_function', 'xml_file', 'config_file', 'text_file', 'semantic_neighborhood'].includes(observation?.kind);
    if (!semantic) {
      return `${base}\n\n${PASS1_OBJECTIVE}\n\nDuring repository orientation, prefer artifacts that can reveal several business arcs or major stages. Tests may be useful maps of business scenarios. Do not drill into test/framework mechanics unless they reveal a business-use-case arc.`;
    }
    return `${PASS1_OBJECTIVE}\n\nCURRENT PASS-1 BUSINESS-ARC BOARD\n${JSON.stringify(this.pass1Board())}\n\n${base}\n\n${PASS1_RETURN}`;
  }

  normalizePass1(parsed) {
    const p = parsed?.pass1 && typeof parsed.pass1 === 'object' ? parsed.pass1 : {};
    const role = ['major', 'supporting', 'trivial'].includes(p.evidenceRole) ? p.evidenceRole : 'supporting';
    const arc = p.arc && typeof p.arc === 'object' ? p.arc : {};
    return {
      evidenceRole: role,
      collapsedMeaning: text(p.collapsedMeaning || parsed?.meaning, 500),
      arc: {
        title: text(arc.title, 180),
        trigger: text(arc.trigger, 300),
        majorStages: uniq(arc.majorStages),
        outcome: text(arc.outcome, 350),
        entities: uniq(arc.entities),
        relationships: uniq(arc.relationships),
        status: ['forming', 'broadly_complete', 'not_a_business_arc'].includes(arc.status) ? arc.status : 'forming'
      },
      arcSeeds: arr(p.arcSeeds).map((seed) => ({
        title: text(seed?.title, 180),
        trigger: text(seed?.trigger, 260),
        outcome: text(seed?.outcome, 260),
        reason: text(seed?.reason, 320)
      })).filter((seed) => seed.title)
    };
  }

  async getSemanticUpdate(args) {
    const result = await super.getSemanticUpdate(args);
    if (result?.parsed && !result.parsed._navigationOnly) {
      result.parsed.pass1 = this.normalizePass1(result.parsed);
      if (result.parsed.pass1.evidenceRole !== 'major' && result.parsed.pass1.collapsedMeaning) {
        // Preserve the model's semantic classification/navigation but keep the
        // durable board at business-stage resolution rather than implementation resolution.
        result.parsed.meaning = result.parsed.pass1.collapsedMeaning;
      }
    }
    return result;
  }

  registerArcSeeds(pass1, observation) {
    for (const seed of arr(pass1?.arcSeeds)) {
      const same = this.state.pass1ArcSeeds.find((item) => item.title.toLowerCase() === seed.title.toLowerCase())
        || this.state.pass1Arcs.find((item) => item.title.toLowerCase() === seed.title.toLowerCase());
      if (same) continue;
      this.state.pass1ArcSeeds.push({
        ...seed,
        status: 'pending',
        discoveredStep: this.state.step,
        evidenceId: observation?.id || ''
      });
    }
    this.state.pass1ArcSeeds = this.state.pass1ArcSeeds.slice(-40);
  }

  mergeArc(pass1, parsed, observation) {
    const arc = pass1?.arc || {};
    if (!arc.title || arc.status === 'not_a_business_arc') return;
    let current = this.state.pass1Arcs.find((item) => item.title.toLowerCase() === arc.title.toLowerCase());
    if (!current) {
      current = {
        title: arc.title,
        trigger: '',
        majorStages: [],
        outcome: '',
        entities: [],
        relationships: [],
        status: 'forming',
        evidence: [],
        createdStep: this.state.step
      };
      this.state.pass1Arcs.push(current);
    }
    if (arc.trigger) current.trigger = arc.trigger;
    if (arc.outcome) current.outcome = arc.outcome;
    current.majorStages = uniq([...current.majorStages, ...arc.majorStages]);
    current.entities = uniq([...current.entities, ...arc.entities]);
    current.relationships = uniq([...current.relationships, ...arc.relationships]);
    if (arc.status === 'broadly_complete') current.status = 'broadly_complete';
    current.evidence.push({
      step: this.state.step,
      artifactId: observation?.id || '',
      role: pass1.evidenceRole,
      meaning: text(parsed?.meaning, 400)
    });
    current.evidence = current.evidence.slice(-20);
    current.updatedStep = this.state.step;
    this.state.pass1Arcs = this.state.pass1Arcs.slice(-30);

    const seed = this.state.pass1ArcSeeds.find((item) => item.title.toLowerCase() === arc.title.toLowerCase());
    if (seed) seed.status = current.status === 'broadly_complete' ? 'complete' : 'pursuing';
  }

  applyDelta(parsed, observation) {
    if (parsed?._navigationOnly) return super.applyDelta(parsed, observation);
    const pass1 = this.normalizePass1(parsed);
    parsed.pass1 = pass1;
    this.registerArcSeeds(pass1, observation);
    this.mergeArc(pass1, parsed, observation);

    if (pass1.evidenceRole === 'trivial') {
      this.state.pass1CollapsedEvidence.push({
        step: this.state.step,
        artifactId: observation?.id || '',
        meaning: pass1.collapsedMeaning,
        reason: 'Pass-1 trivial: internal detail does not materially change the broad business arc.'
      });
      this.state.pass1CollapsedEvidence = this.state.pass1CollapsedEvidence.slice(-200);
      if (typeof this.topology.repositoryCoverageSnapshot === 'function') this.state.sourceCoverage = this.topology.repositoryCoverageSnapshot();
      return;
    }

    return super.applyDelta(parsed, observation);
  }

  nextPendingArcSeed() {
    return this.state.pass1ArcSeeds.find((seed) => seed.status === 'pending') || null;
  }

  activeArcBroadlyComplete() {
    const complete = this.state.pass1Arcs
      .filter((arc) => arc.status === 'broadly_complete')
      .sort((a, b) => Number(b.updatedStep || 0) - Number(a.updatedStep || 0));
    return complete[0] || null;
  }

  async switchToArcSeed(currentId, seed) {
    if (!seed) return null;
    seed.status = 'pursuing';
    const query = `${seed.title} ${seed.trigger || ''} ${seed.outcome || ''} end-to-end business use case`.trim();
    const hits = arr(await this.topology.searchSemantic(query)).filter((hit) => hit?.id && !this.state.visited.includes(hit.id));
    this.state.pass1ArcSwitches.push({ step: this.state.step, from: currentId, title: seed.title, query, hitCount: hits.length });
    this.state.pass1ArcSwitches = this.state.pass1ArcSwitches.slice(-100);
    if (!hits.length) {
      seed.status = 'unresolved';
      return null;
    }
    return {
      id: `pass1-arc-search:${encodeURIComponent(query)}:${this.state.step}`,
      path: query,
      kind: 'semantic_neighborhood',
      summary: `Pass-1 switch to business arc: ${seed.title}`,
      canonical: {
        kind: 'semantic_search_results',
        query,
        pass1ArcSeed: seed,
        nodes: hits.map((hit) => this.candidateDescriptor(hit)),
        note: 'The previous arc is broadly understood for Pass 1; pursue another visible business-use-case arc without deepening implementation detail.'
      },
      neighbors: hits,
      sourceCoverage: null
    };
  }

  async resolveNextAction(action, candidates) {
    const request = action || { type: 'stop' };
    const currentId = this._currentObservationId || '';
    const pendingSeed = this.nextPendingArcSeed();
    const completedArc = this.activeArcBroadlyComplete();

    // Pass 1 deliberately changes subject once a broad arc is coherent. Do not
    // continue spending calls on implementation detail while another visible
    // business arc is waiting to be explored.
    if (completedArc && pendingSeed && ['advance', 'backtrack', 'stop', 'searchSemantic'].includes(request.type)) {
      const switched = await this.switchToArcSeed(currentId, pendingSeed);
      if (switched) return switched;
    }

    const next = await super.resolveNextAction(request, candidates);
    if (next) return next;

    // If the current topology/thread is exhausted, Pass 1 prefers a distinct
    // pending business arc over generic repository wandering.
    const seed = this.nextPendingArcSeed();
    if (seed) return this.switchToArcSeed(currentId, seed);
    return null;
  }
}
