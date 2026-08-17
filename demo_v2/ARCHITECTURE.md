# DataSong v2 semantic exploration architecture

## Core principle

DataSong does not hard-code a closed definition of a flow.

A flow emerges when evidence encountered while traversing the enterprise topology sustains a coherent story around one end-to-end concept. The concept may be small or large. It may begin at a UI action, service, batch job, configuration-driven action, data access, event, function, document rule or any other meaningful point. Structural type does not make something a flow; sustained semantic continuity and coherence do.

## Canonical semantic-function boundary

Source language is an extraction concern, not a reasoning concern.

Before evidence reaches the model, source-specific structure is converted into canonical semantic functions. The model should reason over the same shape whether the source was JavaScript, TypeScript, Python, Java, Groovy, XML, JSON, YAML, environment configuration or another structured source.

A canonical semantic function contains, as available:

- identity and kind
- inputs / parameters
- outputs / returned values
- normalized operations
- conditions
- effects
- outgoing semantic references and their relation types
- source provenance

Examples include ordinary functions and methods, `$module_init.*`, event triggers, callback handlers, service calls, entity reads/writes, routes, `$config.*`, `$env.*`, `$constant.*`, and external black-box functions.

Raw XML/JSON/source syntax stays inside the deterministic parser and provenance layer. It is not duplicated into model prompts when the parser can express the same information canonically.

## Structured containers and repeated elements

Structured sources are harvested into independently addressable semantic units.

- XML elements that carry behavior or meaning (service calls, entity operations, transitions, sections, conditions, iterations, sets, etc.) are semantic units.
- JSON/YAML/config values are value-returning semantic functions.
- Objects within repeated arrays are harvested as separate addressable units when they carry distinct values/meaning.
- Repetition does not imply that every homogeneous data row is a separate semantic function; the parser should preserve meaningful addressability without exploding mechanically repetitive data.

These units are presented to the model when topology or references make them relevant, not by dumping the containing file.

## File coverage is independent of exploration policy

DataSong tracks source coverage independently from semantic-flow exploration.

For each source file, it records the semantic units known in that file and whether each unit has been observed/semantically harvested at least once. Coverage is bookkeeping, not a requirement to traverse every unit immediately.

This allows DataSong to answer both:

1. Which evidence is most useful to explore next for the active semantic narratives?
2. Which semantic units in each source have never been inspected?

A coherent flow may be completed while other units in the same file remain uncovered. Those units remain visible as coverage gaps/frontiers for later exploration.

## Emergent semantic threads

The explorer may maintain multiple candidate semantic threads. A newly observed semantic function is evaluated against all viable threads.

For each thread the model returns:

- continuity: how naturally the function continues the thread from the current evidence frontier
- coherence: how well the function fits the overall story represented by that thread
- bridge: the semantic reason it belongs there

If no existing thread fits, the evidence may remain unattached or seed a new thread. If multiple threads fit well, secondary policy signals such as expected information gain and completion/closure pressure may choose which thread to advance. Completion pressure must never override poor semantic fit.

## Flows are emergent, not declared

A flow is the durable narrative that crystallizes when a sequence/subgraph of semantic functions keeps supporting one coherent concept.

There is no required structural start type and no fixed structural end type. Trigger, state change and outcome evidence may strengthen confidence and closure, but they are observations rather than ontology requirements.

Flows may naturally nest or overlap. A coherent sub-process can be both part of a larger story and independently meaningful when explored as its own thread.

## Topology versus semantics

The topology answers: `What can I inspect from here?`

The semantic explorer answers: `What does this evidence mean, which narrative does it belong to, and which evidence path is promising?`

Mechanical adjacency never forces semantic membership.

## Traversal and rollouts

When there is a single meaningful outgoing path, traversal can continue naturally through the semantic-function graph.

When structural branches appear, the immediate next function is not always enough to identify the promising semantic path. DataSong may therefore maintain multiple candidate trajectories for a thread and perform bounded evidence rollouts: inspect actual downstream semantic functions one at a time, accumulate continuity/coherence/information-gain evidence, then promote, park or prune trajectories.

A rollout is actual evidence gathering over known topology, never model hallucination of unseen code.

Policy ordering is:

1. semantic admissibility to a thread (continuity/coherence)
2. trajectory evidence / expected information gain
3. closure/completion pressure as a secondary preference among semantically plausible alternatives

## Model input contract

Each model call observes one canonical semantic function. Neighboring functions are represented only by canonical descriptors, not by their raw bodies.

The prompt includes:

- current canonical semantic function
- viable semantic threads and their accumulated narrative state
- canonical topology neighbors / candidate functions
- source coverage metadata only when useful for navigation

The model is not asked to rediscover syntax or regenerate the entire semantic board.

## Model return contract

The model is expected to return the semantic interpretation of the current function plus its fit to the viable threads. The canonical response contains:

- meaning
- per-thread continuity/coherence/bridge scores
- best matching thread, or NEW/UNATTACHED
- relation to that thread (continue, branch, subflow, new thread, unattached)
- relative placement in the narrative
- semantic gain / unresolved semantic gap
- next candidate preference when useful

The response contract specifies what information must be returned; DataSong does not impose an arbitrary prompt-size budget as a semantic design rule.

## Cycle safety and reuse

Semantic functions and traversed edges are tracked separately. A previously interpreted semantic function is cached and reused instead of being sent to the model again. Recursive/back edges are preserved as graph relationships without causing traversal cycles.
