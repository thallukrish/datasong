import { ProgressiveRepositoryExplorerV36 } from './progressiveRepositoryExplorerV36.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function text(value, max = 360) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function uniq(values) { return [...new Set(arr(values).map((v) => text(v, 240)).filter(Boolean))]; }

export class ProgressiveRepositoryExplorerV37 extends ProgressiveRepositoryExplorerV36 {
  emptyState() {
    const state = super.emptyState();
    state.arcSchedulerVersion = 'callpaths-pass1-pass2-scout-no-discovery-map-v17';
    if (state.discovery) {
      state.discovery.status = 'disabled';
      state.discovery.activeStartId = '';
    }
    return state;
  }

  // Discovery is intentionally retired from the demo_v2 runtime. Initial
  // business-flow seeds come from deterministic call paths; later novelty
  // comes from Scout as Pass-1 hypotheses that Pass 2 must prove or reject.
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

    if (parsed?._callPathPreprocess) {
      const seededIds = arr(this.state.callPathPreprocess?.seededArcIds);
      if (seededIds.length) {
        const chosen = this.pass1().chooseNextArc(seededIds[0]);
        if (chosen) {
          this.pass2().restore(chosen.id);
          this.state.lastMessage = `Pass 1 scheduled ${chosen.title}; Pass 2 is tracing this deterministic seed.`;
          this.pass1().syncStories();
        }
      }
      return result;
    }

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

  async runScout(candidates) {
    const before = this.snapshot();
    const observation = {
      id: `scout:${this.state.step}`,
      path: 'global novelty scout',
      kind: 'scout_review',
      canonical: { phase: 'scout' }
    };
    const dynamicPrompt = this.scoutPrompt(candidates);
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retry = attempt > 0;
      const prompt = retry ? `${dynamicPrompt}\nRETRY: return complete valid JSON only.` : dynamicPrompt;
      const result = await this.callAndRecordAttempt({ dynamicPrompt: prompt, observation, candidates, before, maxTokens: undefined, retry });
      try {
        const parsed = this.normalizeScout(JSON.parse(result.raw), candidates);
        const byId = new Map(arr(candidates).map((candidate) => [candidate.id, candidate]));
        const ranked = arr(parsed.newDirections)
          .filter((item) => byId.has(item.artifactId) && item.novel !== false && item.pursue !== false)
          .map((item) => ({ ...item, candidate: byId.get(item.artifactId) }))
          .sort((a, b) => (Number(b.novelty || 0) * Number(b.businessUseCaseLikelihood || 0)) - (Number(a.novelty || 0) * Number(a.businessUseCaseLikelihood || 0)));

        const created = [];
        for (const direction of ranked) {
          const hypothesis = this.pass1().createHypothesis({
            title: direction.suggestedArcTitle,
            concept: direction.reason,
            businessActor: direction.businessActor,
            businessIntent: direction.businessIntent,
            confidence: direction.businessUseCaseLikelihood,
            reason: direction.reason
          }, { id: direction.artifactId, path: direction.candidate?.path || direction.artifactId });
          if (!hypothesis) continue;
          hypothesis.seedSource = 'scout';
          hypothesis.scoutArtifactId = direction.artifactId;
          hypothesis.scoutNovelty = Number(direction.novelty || 0);
          created.push({ hypothesis, direction });
        }

        const scout = this.scout().ensureState();
        const chosen = created[0] || null;
        scout.runs.push({
          step: this.state.step,
          reason: scout.pendingReason,
          candidateCount: arr(candidates).length,
          newDirectionCount: created.length,
          chosenHypothesisId: chosen?.hypothesis?.id || '',
          chosenArtifactId: chosen?.direction?.artifactId || '',
          summary: text(parsed.summary, 400)
        });
        scout.runs = scout.runs.slice(-120);
        scout.lastFingerprint = this.scout().fingerprint(candidates);
        scout.pendingReason = '';

        await this.appendRunLog({
          type: 'scout_applied', call: result.callNumber, explorationStep: this.state.step, retry,
          timestamp: new Date().toISOString(), parsedResponse: parsed,
          chosenHypothesisId: chosen?.hypothesis?.id || '', chosenArtifactId: chosen?.direction?.artifactId || ''
        });
        this.pass1().syncStories();
        this.state.lastMessage = chosen
          ? `Scout proposed ${chosen.hypothesis.title}; Pass 2 is gathering evidence for Pass 1.`
          : 'Scout found no materially new business-flow direction; returning to scheduled arcs.';
        this.printCallSummary(result.usage, result.callNumber, chosen ? 'scout seeded Pass-1 hypothesis' : 'scout found no novel direction');
        return chosen;
      } catch (error) {
        lastError = error;
        await this.appendRunLog({ type: 'llm_invalid_scout', call: result.callNumber, explorationStep: this.state.step, retry, timestamp: new Date().toISOString(), error: error.message, rawResponse: result.raw, usage: result.usage, cumulativeUsage: { ...this.state.tokenUsage } });
        this.printCallSummary(result.usage, result.callNumber, `rejected/${error.message}`);
      }
    }
    throw new Error(`No valid Scout response after retry at step ${this.state.step}: ${lastError?.message || 'unknown error'}`);
  }
}
