# LeMap Web Frame-First Runtime Flow

This specification refines the runtime behavior in `2026-09-11-lemap-web-architecture-requirements.md` without changing the domain-neutral entity model.

## Page-first execution rule

A page is learned and completed before LeMap chooses workflow navigation.

```text
capture visible page
→ reconcile generic structure/entities/groups
→ semantic enrichment of unresolved entities
→ reuse/ask/apply required relevant inputs
→ recapture after every browser mutation
→ if new UI appears, push a child runtime frame
→ resolve the child frame with the same structure → semantics → input flow
→ pop completed/closed child frame and resume its parent
→ when the root page has no unresolved required relevant inputs, evaluate navigation
→ filter deterministic global/back/previous/irrelevant candidates
→ use known forward graph knowledge when sufficient
→ ask the model only when multiple plausible continuation candidates remain
→ execute continuation and recapture
```

The model is therefore not a generic next-action agent. Its primary runtime responsibilities are semantic enrichment of unresolved generic entities and disambiguation among already-filtered continuation candidates.

## Dynamic UI and popup frames

A popup, dialog, or newly revealed inline branch does not create a separate application model. Newly revealed nodes are learned into the same persistent entity graph using their normal parent/child, group, and causal relationships.

At runtime, the newly revealed branch pushes a context frame above the current frame. The active child frame is scoped to the revealed subtree (including logical group entities and their members) and runs through the same learning pipeline as the base page. Nested reveals push nested frames.

When a child frame is complete or disappears, it is popped. The parent frame then becomes active again with its prior runtime state intact.

The instance graph is not copied per frame. Concrete values remain in the single local sparse instance graph keyed by canonical entity ID. Push/pop changes runtime scope/actionability only; it does not duplicate structural entities or instance values.

## Persistent graph versus runtime stack

The persistent entity graph may retain relationships such as:

```text
page/container contains child
logical-group hasMember control
action/value dynamicChild revealed-section
revealed-section revealedBy action/value
navigation transitionsTo destination-page
```

The runtime stack separately represents where execution currently is:

```text
page frame
  ↓ push
revealed inline frame / modal frame
  ↓ push
nested frame
  ↑ pop
parent frame
```

Persistent graph relationships survive after a popup closes or an inline branch becomes hidden. Runtime visibility/frame state does not delete learned graph knowledge.

## Navigation rule

Navigation is considered only after the active root page has no unresolved required goal-relevant inputs and no child frame remains to be resolved.

Before asking the model to choose a continuation, deterministic evidence should remove candidates known to be global/site chrome, explicit back/informational actions, or known previous workflow destinations where applicable. Already executed continuation controls in the active frame must not be selected repeatedly.

Unresolved visible buttons/links remain eligible continuation candidates after deterministic filtering; they do not need pre-existing semantic navigation labels merely to be shown to the navigation decision model.

## `maxSteps`

`LEMAP_WEB_MAX_STEPS` protects workflow/page progression. Individual field fills and semantic enrichment iterations within the current page/frame do not consume this counter.

A continuation from the root page consumes a workflow step. A child-frame action that genuinely navigates to a different page also consumes a workflow step. Resolving fields or nested UI inside the same page does not.

This keeps the safety cap from truncating a long form simply because one page contains many required inputs.
