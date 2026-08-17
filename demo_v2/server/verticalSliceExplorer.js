import OpenAI from 'openai';
import { SemanticExplorer } from './explorer.js';

const MODEL_TIMEOUT_MS = 60_000;
const MAX_MODEL_TOKENS = Number(process.env.MAX_MODEL_TOKENS || 900);

const VERTICAL_SLICE_SYSTEM_PROMPT = `You are DataSong's semantic interpretation and exploration policy.

Your objective is to discover and close END-TO-END VERTICAL SLICES OF ENTERPRISE USE CASES.

A vertical slice is a coherent chain of behavior that begins from a trigger, intent, request, input, schedule, event, or other meaningful starting condition; crosses whatever implementation/data/policy boundaries are relevant; and reaches a meaningful outcome or produced state.

A slice may emerge as a customer workflow, employee workflow, ETL/data pipeline, algorithmic process, operational procedure, service interaction, policy-driven process, or another coherent use case. Do not decide its type in advance.

You inspect one artifact at a time. Distinguish:

1. ORIENTATION EVIDENCE
Repository roots, directories, README/build/component/ignore files and generic framework configuration help you understand the environment and navigate it. They do NOT form a vertical slice by themselves.

2. SLICE EVIDENCE
Evidence that can be placed into an end-to-end use-case path: a trigger/input, action, transformation, decision, state change, handoff, persistence effect, or outcome.

3. UNATTACHED EVIDENCE
Potentially meaningful evidence that cannot yet be placed confidently into a slice.

Never create paths such as "Repository overview", "configuration", "tests", "JMeter tests", "service layer", or another artifact/container name. A path title must name the use case or process being accomplished, such as "Customer places an order", "Nightly sales aggregation", "Refund approval", or "Price calculation".

For each artifact return only a compact semantic delta:
- what this artifact means;
- semanticRole = orientation | story | unattached;
- if story: which vertical slice it continues, or NEW;
- semantic continuity with that slice;
- one semantic bridge explaining how this evidence advances the slice;
- where it belongs relative to known steps;
- whether it continues, branches, or exposes a reusable subflow;
- the next artifact/search expected to maximize information gain toward closing a vertical slice.

Discovery order is NOT story order. New evidence may fit before, after, between, parallel to, or on a branch from previously discovered steps.

Prefer CAUSAL/OPERATIONAL CONTINUATION over mere source proximity. A direct call/reference is valuable when it advances the use case, but a helper/logger/framework utility may be semantically low-value.

Once a real vertical slice has momentum, prefer evidence that extends it toward its beginning/outcome, fills an internal gap, or closes a known branch. Do not abandon a nearly coherent slice for unrelated novelty unless its local expected gain has clearly dampened.

Branches belong to the parent slice and remain open until explored or explicitly bounded. A reusable independently meaningful sub-flow becomes a separately explorable slice/dependency. Source outside the supplied repository is a black box: record only the input/output/effect contract required by the local slice and do not request its implementation.

A vertical slice is complete only when its main progression has a meaningful start and outcome and every material discovered branch is closed or bounded. Do not require traversal of irrelevant technical internals.

Return strict JSON only. Never regenerate the whole semantic board.`;

function safeString(value, max = 800) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export class VerticalSliceExplorer extends SemanticExplorer {
  buildPrompt(observation, candidates) {
    const board = this.state.stories.slice(0, 6).map((story) => ({
      id: story.id,
      title: story.title,
      nature: story.nature,
      progress: story.progress,
      status: story.status,
      steps: story.steps.slice(-12).map((step) => ({
        id: step.id,
        meaning: step.meaning,
        bridge: step.bridge,
        relation: step.relation,
        branchId: step.branchId || null
      })),
      branches: story.branches.map((branch) => ({
        id: branch.id,
        label: branch.label,
        status: branch.status,
        progress: branch.progress
      })),
      dependencies: story.dependencies.map((dependency) => ({
        id: dependency.id,
        label: dependency.label,
        scope: dependency.scope,
        contract: dependency.contract
      })),
      openQuestions: story.openQuestions.slice(0, 6)
    }));

    const candidateDescriptors = candidates.map((candidate) => ({
      id: candidate.id,
      path: candidate.path,
      kind: candidate.kind,
      relation: candidate.relation,
      label: candidate.label,
      hint: safeString(candidate.hint, 160),
      locality: candidate._locality || 'global'
    }));

    const shape = {
      meaning: 'one short semantic statement',
      semanticRole: 'orientation|story|unattached',
      pathId: 'existing story id | NEW | UNATTACHED',
      pathTitle: 'for NEW: name the end-to-end use case, never the artifact/container',
      pathNature: 'optional emergent nature of the vertical slice',
      continuity: 0.0,
      bridge: 'how this artifact advances or fits the vertical slice',
      relation: 'continue|branch|subflow|new_story|unattached',
      placement: {
        type: 'after|before|between|branch_from|parallel|unknown',
        afterStepId: 'optional',
        beforeStepId: 'optional',
        branchFromStepId: 'optional',
        confidence: 0.0
      },
      coherenceGain: 0.0,
      branch: { id: 'optional', label: 'optional', status: 'open|closed|bounded' },
      dependency: { label: 'optional', scope: 'local|external', contract: 'optional input/output/effect' },
      closes: 'none|branch|story',
      resolvesQuestionIds: ['optional existing question ids'],
      openQuestion: 'optional next semantic gap in this vertical slice',
      next: {
        type: 'artifact|search|stop',
        artifactId: 'candidate id',
        query: 'search query',
        expectedGain: 0.0,
        reason: 'why this best advances or closes a vertical slice'
      }
    };

    return `ORIENTATION CONTEXT\n${JSON.stringify(this.state.orientation.slice(-8))}\n\nCURRENT VERTICAL SLICES\n${JSON.stringify(board)}\n\nACTIVE SLICE\n${JSON.stringify(this.activeStoryId || null)}\n\nOBSERVED ARTIFACT\n${JSON.stringify({
      id: observation.id,
      path: observation.path,
      kind: observation.kind,
      summary: observation.summary,
      excerpt: observation.excerpt || ''
    })}\n\nAVAILABLE NEXT ARTIFACTS\n${JSON.stringify(candidateDescriptors)}\n\nReturn exactly one compact JSON object shaped like:\n${JSON.stringify(shape)}\n\nRules:\n- Root/directories/README/build/component/ignore/framework configuration normally have semanticRole=orientation.\n- Only create/update a story when the artifact can genuinely be placed in an end-to-end vertical use-case slice.\n- A test may reveal a slice, but name the behavior under test, not the test artifact/framework.\n- pathId must be an existing slice id, NEW, or UNATTACHED.\n- Prefer a local direct call/reference that causally continues the active slice over unrelated siblings/global artifacts.\n- If evidence appears to belong earlier in the slice, place it before/between existing steps; discovery order is irrelevant.\n- If it reveals a material alternative, use relation=branch and keep that branch open.\n- If it invokes a separately meaningful process, use relation=subflow instead of recursively inlining it.\n- Use search only when the next semantic gap cannot be resolved by available local candidates.\n- Keep the response very short.`;
  }

  async callModel(dynamicPrompt, maxTokens = MAX_MODEL_TOKENS) {
    return this.client.chat.completions.create({
      model: this.modelName,
      messages: [
        { role: 'system', content: VERTICAL_SLICE_SYSTEM_PROMPT },
        { role: 'user', content: dynamicPrompt }
      ],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens
    });
  }

  async callAndRecordAttempt({ dynamicPrompt, observation, candidates, before, maxTokens, retry }) {
    const response = await this.callModel(dynamicPrompt, maxTokens);
    const raw = response.choices?.[0]?.message?.content || '{}';
    const finishReason = response.choices?.[0]?.finish_reason || '';
    const usage = this.accountUsage(response.usage || {});
    const callNumber = ++this.modelCallCount;

    await this.appendRunLog({
      type: 'llm_attempt',
      call: callNumber,
      explorationStep: this.state.step,
      retry,
      timestamp: new Date().toISOString(),
      observedArtifact: observation,
      candidates,
      semanticBoardBefore: before,
      systemPrompt: VERTICAL_SLICE_SYSTEM_PROMPT,
      prompt: dynamicPrompt,
      rawResponse: raw,
      finishReason,
      usage,
      cumulativeUsage: { ...this.state.tokenUsage }
    });

    return { raw, usage, finishReason, callNumber, retry, promptUsed: dynamicPrompt };
  }
}
