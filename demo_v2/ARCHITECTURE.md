# DataSong v2 semantic exploration architecture

## Core principle

DataSong does not hard-code a closed definition of a flow.

A flow emerges when evidence encountered while traversing the enterprise topology sustains a coherent story around one end-to-end concept. The concept may be small or large. It may begin at a UI action, service, batch job, configuration-driven action, data access, event, function, document rule or any other meaningful point. Structural type does not make something a flow; sustained semantic continuity and coherence do.

## Role inversion: model navigates, DataSong supplies evidence

The model is the semantic navigator. DataSong is the deterministic evidence environment, graph engine and durable state manager.

The model does not receive arbitrary files pushed by DataSong and is not asked to choose from opaque filename-level entrypoints. Instead it asks for canonical evidence as its semantic understanding develops.

The evidence operations are:

- `getArtifact(id)` — return one canonical semantic function/config/object;
- `getNeighbors(id, depth)` — return a bounded canonical topology neighborhood, depth 1 through 4;
- `searchSemantic(query)` — return canonical semantic functions relevant to a semantic question;
- `advance` — after a neighborhood evaluation, ask DataSong to choose the strongest admissible path from the model's continuity/coherence/information-gain scores;
- `backtrack` — signal that the present trajectory has flattened or drifted so DataSong should resume another stored DFS branch;
- `stop` — no useful semantic evidence request remains from the model's current perspective.

The model chooses semantic direction and semantic questions. DataSong resolves those requests against the real graph and controls exact traversal mechanics.

## Canonical semantic-function boundary

Source language is an extraction concern, not a reasoning concern.

Before evidence reaches the model, source-specific structure is converted into canonical semantic functions. The model reasons over the same shape whether the source was JavaScript, TypeScript, Python, Java, Groovy, XML, JSON, YAML, environment configuration or another structured source.

A canonical semantic function contains, as available:

- identity and kind
- inputs / parameters
- outputs / returned values
- normalized operations
- conditions
- effects
- outgoing semantic references and their relation types
- source provenance

Examples include ordinary functions and methods, `$module_init.*`, event triggers, callback handlers, service calls, entity reads/writes, routes, `$config.*`, `$env.*`, `$constant.*`, JSON objects and external black-box functions.

Raw XML/JSON/source syntax stays inside the deterministic parser and provenance layer. It is not duplicated into model prompts when the parser can express the same information canonically.

## Structured containers and repeated elements

Structured sources are harvested into independently addressable semantic units.

- XML elements that carry behavior or meaning (service calls, entity operations, transitions, sections, conditions, iterations, sets, etc.) are semantic units.
- JSON/YAML/config values are value-returning semantic functions.
- Objects within repeated arrays are harvested as separate addressable units when they carry distinct values/meaning.
- Repetition does not imply that every homogeneous data row is a separate semantic function; the parser preserves meaningful addressability without exploding mechanically repetitive data.

These units are presented to the model when topology, references or explicit model requests make them relevant, never by dumping the containing file.

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

- continuity: how naturally the function continues the thread from the current evidence frontier;
- coherence: how well the function fits the overall story represented by that thread;
- bridge: the semantic reason it belongs there.

If no existing thread fits, the evidence may remain unattached or seed a new thread. If multiple threads fit well, secondary policy signals such as expected information gain and closure pressure may influence which path is explored. Closure pressure must never override poor semantic fit.

## Flows are emergent, not declared

A flow is the durable narrative that crystallizes when a sequence/subgraph of semantic functions keeps supporting one coherent concept.

There is no required structural start type and no fixed structural end type. Trigger, state change and outcome evidence may strengthen confidence and closure, but they are observations rather than ontology requirements.

Flows may naturally nest or overlap. A coherent sub-process can be both part of a larger story and independently meaningful when explored as its own thread.

## Topology versus semantics

The topology answers: `What evidence is actually reachable from here?`

The model answers: `What semantic direction or question should I pursue?`

DataSong answers: `Given that semantic intent, which real graph evidence should be returned or traversed?`

Mechanical adjacency never forces semantic membership.

## Model-directed browsing loop

The normal loop is:

1. DataSong presents the current canonical artifact plus accumulated semantic threads.
2. The model interprets that artifact and scores its continuity/coherence against every viable thread.
3. The model requests more evidence with `getArtifact`, `getNeighbors`, or `searchSemantic`.
4. DataSong resolves the request deterministically against the canonical topology.
5. If `getNeighbors` was requested, DataSong returns a bounded lightweight neighborhood rather than full bodies.
6. The model scores promising neighborhood candidates for continuity, coherence and expected information gain.
7. On `advance`, DataSong calculates the strongest admissible candidate and traverses it.
8. When the trajectory signal flattens, the model may request `backtrack`; DataSong resumes another stored DFS branch.
9. Previously interpreted semantic functions are reused from cache rather than re-sent for semantic interpretation.

This preserves model agency over meaning while preventing repository-navigation mechanics from becoming an LLM responsibility.

## Neighborhood rollouts

Immediate adjacency is often insufficient to identify the semantically promising branch. A call graph can expose validation, metrics, persistence, error handling and side effects at the same structural level even though only one trajectory carries the main semantic story.

The model may therefore request `getNeighbors(id, depth=1..4)`.

DataSong returns canonical essence only:

- artifact id
- relation
- function/config identity
- canonical kind
- inputs/outputs
- normalized operations
- conditions
- topology edges/depth

It does not recursively dump full implementation bodies.

The model returns per-candidate:

- thread id (or NEW/UNATTACHED)
- continuity
- coherence
- expected information gain
- short reason

DataSong combines those signals to choose the path on `advance`. If all local trajectories have weak semantic fit, DataSong should not force structural adjacency; it backtracks to another stored branch/frontier.

A rollout is therefore actual evidence gathering over known topology, never model hallucination of unseen code.

## DFS and branch management

DataSong maintains deterministic traversal state:

- visited semantic functions
- visited edges
- cycle/back-edge information
- execution/DFS stacks
- pending sibling branches
- per-thread trajectory evidence
- source coverage
- canonical interpretation cache

The model does not manually maintain these structures.

When signal remains strong, traversal advances. When it flattens or the model explicitly asks to backtrack, DataSong returns to the nearest stored branch with unresolved evidence, then may eventually return to broader global frontiers.

## Semantic path selection

Path selection is ordered conceptually as:

1. semantic admissibility to a thread (continuity/coherence)
2. trajectory evidence / expected information gain
3. closure/completion pressure only as a secondary preference among already plausible alternatives

Completion pressure is never allowed to make an unrelated artifact part of a nearly complete thread.

## Model input contract

The model receives structured canonical evidence, never a generic read/search dump.

For artifact interpretation, the prompt includes:

- current canonical semantic artifact
- viable semantic threads and their accumulated narrative state
- currently known local/inventory canonical artifacts
- source coverage metadata where relevant
- the evidence-operation contract

For neighborhood evaluation, the prompt includes:

- anchor artifact
- bounded canonical neighborhood
- lightweight candidate essence
- viable semantic threads
- the candidate-scoring contract

## Model return contract

For an artifact, the model returns:

- meaning
- per-thread continuity/coherence/bridge
- best matching thread, or NEW/UNATTACHED
- relation to that thread
- relative placement
- semantic gain / unresolved gap
- an evidence request (`getArtifact`, `getNeighbors`, `searchSemantic`, `backtrack`, `stop`)

For a neighborhood, the model returns:

- candidate scores (thread, continuity, coherence, expected gain, reason)
- an evidence request (`advance`, `getArtifact`, `getNeighbors`, `searchSemantic`, `backtrack`, `stop`)

The response contract defines expected semantics; DataSong does not impose an arbitrary semantic prompt-size budget.

## Cycle safety and reuse

Semantic functions and traversed edges are tracked separately. A previously interpreted semantic function is cached and reused instead of being sent to the model again. Recursive/back edges are preserved as graph relationships without causing traversal cycles.
