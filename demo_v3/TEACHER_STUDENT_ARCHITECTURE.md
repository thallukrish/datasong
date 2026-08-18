# DataSong v3 — Teacher / Student Semantic Navigator

## 1. Objective

DataSong v3 treats semantic navigation as a **learned scoring problem** rather than an increasingly rule-driven exploration problem.

The student must learn to answer:

> Given a current enterprise evidence artifact, its local neighbours, and the compact state of previously discovered arcs, how strongly does this evidence belong to each existing arc, does it instead support a new business or technical arc, and which next evidence is most valuable to inspect?

The long-term asset is a student model that learns how business behavior is expressed through technical enterprise evidence.

The teacher's objective is therefore no longer merely to satisfy a navigation prompt. The teacher is used to **train, diagnose and strengthen the student**.

---

# 2. Separation of responsibilities

```text
DATASONG
canonical evidence + topology + state + execution

STUDENT MODEL
semantic scores

TEACHER LLM
supervision + diagnosis + curriculum generation

LLM NARRATOR
human-readable descriptions of stable arcs/use cases
```

DataSong remains deterministic wherever possible.

It owns:

```text
repository traversal
artifact parsing/canonicalization
function/XML/config exposure
neighbour discovery
canonical IDs
arc state persistence
entities and persisted-object state
visited/frontier bookkeeping
provenance
run logs
student invocation
application of student scores
```

The student owns semantic judgement.

The teacher supervises the student during training.

The narrator converts a stable structured arc into user-readable prose; narration is not the semantic source of truth.

---

# 3. Evidence packet produced by DataSong

DataSong generates a structured packet for every semantic decision.

Conceptually:

```json
{
  "phase": "scout | pass1 | pass2",

  "currentEvidence": {
    "artifactId": "...",
    "artifactType": "function | xml | config | document | schema | ...",
    "canonicalContent": "function body / selected XML hierarchy / canonical structured evidence",
    "provenance": "..."
  },

  "neighbours": [
    {
      "artifactId": "...",
      "relation": "calls | child | reads | writes | references | ...",
      "signature": "identity/signature only"
    }
  ],

  "arcs": [
    {
      "arcId": "...",
      "title": "...",
      "arcType": "business | technical",
      "actor": "...",
      "goal": "...",
      "steps": ["..."],
      "entities": ["..."],
      "persistedObjects": ["..."],
      "outcome": "...",
      "compactEvidenceSummary": "..."
    }
  ],

  "recentPath": ["..."],
  "priorScores": "compact score trajectory where useful"
}
```

The current artifact may be detailed. Candidate neighbours remain compact signatures until selected.

The packet should be canonical and inspectable. The student should not depend on hidden DataSong rules to infer semantics.

---

# 4. Learning objective

For every evidence state, the student predicts a common semantic score space.

## Existing arc scores

For every existing arc:

```text
membership      0..1
continuity      0..1
coherence       0..1
expectedGain    0..1
```

### Membership

How strongly does the evidence belong to this existing arc?

This is the principal Pass-1 matching signal.

### Continuity

How naturally does this evidence continue the currently accumulated path/steps of the arc?

### Coherence

Does accepting this evidence improve the overall semantic story represented by the arc, or does it make that story less coherent?

### Expected gain

How likely is following this evidence to reveal a missing business stage, decision, entity relationship, persisted state change, outcome or other useful semantic information?

---

# 5. New-arc scores

The model must also predict whether current evidence is better understood outside the existing arc board.

Conceptually:

```text
newArcLikelihood              0..1
newBusinessUseCaseLikelihood  0..1
newTechnicalUseCaseLikelihood 0..1
unrelatedLikelihood           0..1
```

The student must learn the latent distinction between examples such as:

```text
business use case
- customer places an order
- operator releases an order for fulfillment
- clerk applies payment to an invoice

technical use case / technical story
- storefront navigation
- UI screen setup
- configuration registration
- dependency initialization
- developer/test lifecycle

supporting evidence
- a UI element or config item that contributes to a business arc but is not itself a use case
```

No closed title-based ontology should encode this distinction in DataSong rules. It is a learned semantic distinction.

---

# 6. Neighbour / action scores

For each supplied neighbour signature, the model emits a value indicating the usefulness of selecting it next.

Example:

```text
submitOrder()          0.94
validateCart()         0.81
renderToolbar()        0.08
loadThemeConfig()      0.03
```

The most important requirement is correct **ranking**, not exact numerical agreement.

Training should therefore include both absolute score losses and ranking/preference losses.

---

# 7. Scout, Pass 1 and Pass 2 become views over one learned score space

The student should not contain three independent intelligence systems.

The same predictions are interpreted differently by DataSong depending on the phase.

## Scout

Question:

> Is there evidence of a materially new semantic direction not represented by existing arcs?

Scout emphasizes:

```text
low membership to existing arcs
+
high newBusinessUseCaseLikelihood
or high newTechnicalUseCaseLikelihood when tracking technical narratives is useful
```

## Pass 1

Question:

> Which existing arc is this evidence most strongly associated with, and which arc deserves the next semantic turn?

Pass 1 emphasizes:

```text
membership
coherence
expectedGain
```

## Pass 2

Question:

> Within the selected arc, which neighbour best continues/improves the end-to-end story?

Pass 2 emphasizes:

```text
continuity
coherence
expectedGain
neighbour ranking
```

Thus Scout / Pass 1 / Pass 2 are orchestration views over a shared semantic model.

---

# 8. Student model structure

## Initial model

The first laptop prototype should use a **pretrained code-and-language encoder**, not a model trained from scratch.

The model already needs latent understanding of:

```text
function names
signatures
identifiers
comments
code bodies
XML tags and attributes
JSON/YAML/config names
entity/schema names
natural-language business terms
arc summaries
```

The proposed first student is:

```text
UniXcoder-base
```

with CodeBERT-base as an easy baseline comparison.

The reason for starting with a small encoder is that the first goal is to validate whether DataSong's semantic judgement can be distilled at all, while allowing rapid repeated local training and checkpointing.

A future comparison should include a small causal code model such as Qwen2.5-Coder-0.5B, followed by larger models on stronger hardware/cloud if necessary.

## Initial representation

For v1, serialize the structured evidence state into an inspectable compact text representation and feed it through the encoder.

Do **not** begin with a complex persistent latent-memory architecture.

Conceptually:

```text
[CURRENT EVIDENCE]
...

[ARC]
actor ...
goal ...
steps ...
entities ...
persisted objects ...

[CANDIDATE]
...
```

For an evidence/arc pair:

```text
serialized state
      ↓
code/language transformer encoder
      ↓
shared latent representation
      ↓
small scoring heads
```

Possible heads:

```text
membership head
continuity head
coherence head
expected-gain head
new-business head
new-technical head
unrelated head
candidate-value/ranking head
```

A cross-encoder style representation is preferred initially over independently embedding evidence and arcs and using only cosine similarity, because the meaning of an artifact depends strongly on the particular arc against which it is being judged.

Later, if needed, DataSong may introduce a learned persistent latent arc state updated as evidence accumulates.

---

# 9. Initial hardware constraint

The first training loop runs locally on:

```text
Windows 11
Intel Core i7-10510U
16 GB system RAM
NVIDIA GeForce MX350
2 GB VRAM
```

This strongly favors a small encoder and incremental fine-tuning rather than repeated local training of multi-billion-parameter LLMs.

Initial progression:

```text
Stage 1
freeze most/all encoder layers
train DataSong scoring heads

Stage 2
unfreeze top encoder layers
train top layers + heads

Stage 3
broader fine-tuning only if evidence shows it is necessary
```

The learning experiment should prioritize fast iterations, observable loss curves, checkpoint/rollback and repeated synthetic curricula over maximum model size.

---

# 10. Teacher role

During the first iteration ChatGPT acts as the teacher and training orchestrator through MCP.

For each real evidence state:

```text
DataSong emits evidence packet
        ↓
student emits prediction scores
        ↓
ChatGPT independently emits teacher scores
        ↓
student ↔ teacher comparison
```

The teacher then diagnoses *why* the student diverged.

Example failure classes:

```text
new_business_use_case_discovery_failure
business_vs_technical_failure
arc_membership_failure
continuity_failure
coherence_failure
novelty_failure
neighbour_ranking_failure
entity_or_persistence_reasoning_failure
cross_artifact_reasoning_failure
```

Multiple labels may apply to one error.

The teacher explanation is useful diagnostic metadata but is not itself the numerical target used for regression.

---

# 11. Adaptive curriculum generation

The teacher does not merely label the failing real example.

After identifying a weakness, it creates a targeted micro-curriculum of synthetic evidence packets that exercise the same latent distinction.

Example real failure:

```text
current arc: Sales Order

student
submitOrder()      0.48
renderToolbar()    0.72

teacher
submitOrder()      0.94
renderToolbar()    0.08
```

Diagnosis:

```text
continuity_failure
business_vs_technical_failure
```

Synthetic curriculum may include analogous patterns from different surface domains:

```text
reviewCart → placeOrder vs renderHeader
approveInvoice → persistApproval vs renderPanel
confirmShipment → updateShipmentStatus vs loadTheme
submitExpense → createApprovalRequest vs initializeWidget
```

Synthetic evidence should mimic the same **canonical artifact packet structure** that the student sees from DataSong, rather than becoming purely natural-language examples.

The teacher should also generate hard negatives and counterfactuals derived from real evidence.

---

# 12. Episode loop

One real DataSong navigation state may result in several synthetic rollouts before the system advances.

Conceptually:

```text
1. DataSong emits real state E
2. student predicts S
3. teacher predicts T
4. calculate losses
5. teacher diagnoses divergence
6. teacher generates focused synthetic samples
7. train student on real + synthetic batch
8. reevaluate original state E
9. inspect whether loss and behavior improved
10. if weakness remains, generate another curriculum rollout
11. once acceptable, DataSong applies student scores and advances
12. next real evidence state
```

The objective is not to force an arbitrary number of rollouts. Training continues while the episode exposes a meaningful unresolved weakness.

---

# 13. Losses

The model should not rely on one MSE number.

A conceptual total objective is:

```text
L =
  λ_membership   * L_membership
+ λ_continuity   * L_continuity
+ λ_coherence    * L_coherence
+ λ_gain         * L_expected_gain
+ λ_new_arc      * L_new_arc_classification
+ λ_business     * L_business_vs_technical
+ λ_rank         * L_candidate_ranking
```

Pairwise/listwise ranking loss is important because semantic navigation depends heavily on ordering candidates correctly even when absolute 0..1 calibration is imperfect.

The training system should expose each component separately.

---

# 14. Behavioral loss

A declining numerical loss is insufficient.

DataSong must also measure behavioral failures such as:

```text
wrong arc selected
new business use case missed
technical/UI/config story promoted as business use case
correct business arc stalls
wrong neighbour selected
coherence of arc deteriorates
same business use case incorrectly split into new arcs
materially different use case incorrectly merged into an existing arc
```

A successful update should reduce both score disagreement and navigation mistakes.

---

# 15. Training data pools

Maintain at least three logical pools.

```text
TRAIN
teacher-labelled real samples + targeted synthetic samples

REPLAY
older mastered examples to reduce catastrophic forgetting

VALIDATION
held-out real evidence never used to generate the immediate synthetic curriculum
```

Synthetic improvement must be validated against untouched real evidence.

---

# 16. Training episode log

Every episode should be preserved separately from the normal exploration run log.

Conceptually:

```text
demo_v3/data/training/
  episode-000001.jsonl
  episode-000002.jsonl
  ...

checkpoints/
  student-000001/
  student-000002/
```

An episode record should preserve:

```text
real evidence packet
student prediction before training
teacher target
diagnosed weaknesses
teacher explanation
synthetic samples generated
training loss history
student prediction after each rollout
behavioral result
checkpoint used/created
```

This makes the learning process inspectable and rewindable.

---

# 17. ChatGPT / MCP interaction model

The first implementation intentionally keeps ChatGPT in the loop so the process can be stopped, inspected and corrected manually before replacing the teacher with an API-driven autonomous service.

Proposed MCP surface:

## DataSong tools

```text
datasong.start_episode
datasong.get_state
datasong.get_evidence
datasong.apply_scores
datasong.advance
datasong.get_run_log
datasong.reset_or_restore
```

## Student tools

```text
student.score
student.train
student.evaluate
student.get_metrics
student.save_checkpoint
student.restore_checkpoint
```

## Training-data tools

```text
training.add_teacher_sample
training.add_synthetic_batch
training.get_episode
training.get_loss_history
training.get_skill_metrics
training.list_checkpoints
```

The exact MCP method names can change during implementation, but the separation of responsibilities should remain.

---

# 18. Interactive first-iteration orchestration

Initially ChatGPT performs the orchestration explicitly:

```text
ChatGPT
  ↓ MCP
DataSong: produce current evidence packet
  ↓ MCP
Student: score current state
  ↓
ChatGPT: independently score as teacher
  ↓
ChatGPT: compare + diagnose weakness
  ↓
ChatGPT: generate synthetic evidence packets
  ↓ MCP
Trainer: add examples + train student
  ↓ MCP
Student: reevaluate
  ↓
ChatGPT: inspect component losses + behavioral change
  ↓
repeat synthetic rollout when useful
  ↓ MCP
DataSong: apply STUDENT scores and advance
```

Crucially, production navigation during this experiment should advance using the **student's scores**, not the teacher's scores. The teacher is supervising the learner rather than silently replacing it.

---

# 19. Skill matrix

Track student capability by semantic skill rather than only one aggregate loss.

Possible metrics:

```text
business-vs-technical discrimination
new-business-use-case discovery
existing-arc membership
continuity prediction
coherence prediction
neighbour ranking
novelty detection
entity/persistence reasoning
cross-artifact reasoning
```

Teacher curriculum generation can target the weakest dimensions.

Over time, teacher calls should become concentrated on unfamiliar or uncertain regions rather than every state.

---

# 20. Human-readable use-case descriptions

The student is initially a **semantic scorer**, not a prose generator.

A stable DataSong arc remains structured state:

```text
actor
goal
steps
entities
persisted objects
relationships
completion condition
outcome
evidence/provenance
```

An LLM narrator is invoked only when a user-readable description is needed.

```text
structured stable arc
        ↓
LLM narrator
        ↓
title
concise business summary
step-by-step use-case description
business meaning
```

Narration is regenerable presentation. The structured arc and its evidence remain the source of truth.

Narration may later be distilled into a smaller generative model if cost becomes meaningful, but it is explicitly outside the first student-model learning objective.

---

# 21. First milestone

Do not initially optimize for cross-repository generalization.

The first milestone is:

> From a clean PopNow exploration, can the locally trained student reproduce teacher semantic rankings closely enough that meaningful business arcs such as Sales Order progress coherently, while UI/config/developer stories remain appropriately classified and low-ranked unless they are genuinely supporting evidence?

Success criteria should include:

```text
teacher/student score disagreement declines
candidate ranking agrees materially with teacher
business-vs-technical errors decline
known important business arcs advance
technical/UI-only arcs do not dominate
held-out real PopNow states improve after synthetic curricula
training remains stable under replay
```

Only after this works should DataSong test transfer to a second repository.

---

# 22. Continual learning across repositories

The intended evolution is:

```text
pretrained code/language model
        ↓
PopNow teacher-supervised curriculum
        ↓
DataSong semantic navigator v1
        ↓
new repository
        ↓
student predicts + teacher corrects unfamiliar cases
        ↓
targeted adaptation
        ↓
DataSong semantic navigator v2
```

The goal is for teacher dependence to fall as the shared student weights learn reusable semantic patterns across enterprises.

Repository-specific adapters may be introduced later if necessary, while preserving a shared base model and replay corpus to avoid catastrophic forgetting.

---

# 23. Governing principle

DataSong v3 should preserve a clean boundary:

> **DataSong constructs and navigates the evidence world. The student learns how that evidence relates to evolving business and technical narratives. The teacher identifies the student's semantic weaknesses and teaches them away.**

The resulting learned semantic navigator — not a growing set of traversal heuristics — is intended to become the core reusable intelligence of DataSong.
