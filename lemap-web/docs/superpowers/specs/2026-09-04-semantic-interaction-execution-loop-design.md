# Semantic Interaction Execution Loop Design

## Goal

LeMap-Web must decide where to begin on a newly encountered browser context by combining deterministic structural evidence with one page/local-context semantic interpretation. The semantic model proposes meaning, relevant user-facing interactions, workflow-action roles, interaction ordering and behavioral generalization. Deterministic browser execution proves state, structure and behavior.

## Invariant

> The model proposes meaning, priority and generalization. LeMap-Web proves state, structure and behavior through execution.

## Current-context algorithm

1. Capture visible fields, groups, actions, option/value domains, enabled/disabled state and hierarchy.
2. Send a compact structural summary plus the original goal to the local semantic resolver.
3. The resolver returns semantic entities/sub-entities plus a page interaction plan:
   - relevant user-input interactions;
   - reusable question/explanation/examples;
   - application/local scope and reuse policy;
   - goal relevance and interaction priority;
   - structural dependencies;
   - action roles such as local action, branch action and workflow continuation;
   - a behavior-generalization hypothesis with confidence.
4. Deterministic code resolves the next executable interaction from current state: prefilled, remembered, blocked or missing.
5. Execute a real user/remembered/prefilled interaction and capture before/after state.
6. Compute the external structural delta, excluding trivial source-value changes.
7. If there is no external change, continue with the next unresolved planned interaction.
8. If the effect matches a known behavior class, continue locally and strengthen evidence.
9. If the effect exposes/hides/enables/disables structure in a way not covered by a known behavior class, invoke semantic resolution once with the structural delta. The result may create/extend semantic sub-entities and relationships keyed by the triggering interaction/behavior class.
10. If the structural root/route changes through a reversible workflow action, record the transition as a workflow step and repeat from step 1 in the new context.
11. Completion requires both structural plausibility (no unresolved required interaction and no safe forward action) and semantic goal-completion evidence.

## Semantic contract

Each `interaction` may include:

- `semanticKey`
- `semanticName`
- `structuralFieldIds`
- `explanation`
- `question`
- `examples[]`
- `valueScope`: `application|actor|workflow|workflow_instance`
- `reusePolicy`: `always|same_scope|confirm|never`
- `goalRelevance`: 0..1
- `priority`: integer, lower means earlier
- `requiredForGoal`: boolean
- `dependsOnSemanticKeys[]`
- `behaviorHypothesis`:
  - `mode`: `same_effect_across_domain|value_specific|unknown`
  - `confidence`: 0..1
  - `description`

Each semantic action may include:

- `structuralFieldId`
- `semanticName`
- `description`
- `role`: `local_entity_action|branch_action|workflow_continuation|workflow_reverse|global_navigation|unknown`

The model's behavior hypothesis is not proof. Real executions remain authoritative. A different observed external effect creates a new behavior class regardless of prior model confidence.

## Structural novelty and entity relationships

When a real interaction reveals a nested region, modal, or additional field group, deterministic code records the source interaction and external delta. Semantic resolution interprets the new structure and may create sub-entities/relationships. The persisted relationship is linked to the source `semanticKey` and behavior-class ID; private user values are not required in semantic memory.

## Global versus local

Recurring controls structurally observed across distinct local entities belong to application scope. Their semantics remain available for goals that target them, but they do not create local workflow coverage pressure for unrelated goals.

## Workflow accumulation

A page is presentation evidence, not the semantic primitive. Local entities and relationships can exist within one rendered context. Reversible transitions between structural roots/contexts accumulate into workflow steps. Over multiple runs, LeMap-Web therefore builds both:

- a shared entity/relationship graph; and
- a goal-directed workflow graph linking execution stages across rendered contexts.

## Safety

Automatic execution remains restricted to actions semantically classified as reversible. Commit, financial, destructive, security-sensitive or unknown consequences are not auto-executed.
