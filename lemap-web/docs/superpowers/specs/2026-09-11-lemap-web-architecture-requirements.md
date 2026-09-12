# LeMap Web Architecture Requirements

## Purpose

LeMap Web shall use a small number of clean layers with explicit responsibilities: browser/DOM capture, UI adapters, canonical structural entities, orchestration, entity graph, instance graph, workflow traversal, semantic/LLM interaction, browser execution, privacy, and configuration.

The architecture shall avoid parallel representations, hidden heuristic pipelines, and cross-layer logic that duplicates responsibility.

The core architecture shall remain domain-neutral. The same LeMap Web implementation shall be capable of learning and traversing an income-tax filing site, a travel-booking site, a banking site, an insurance site, or another web application without introducing domain-specific entity classes into the core.

## 1. Browser / DOM Layer

- The browser layer shall observe the current visible DOM state from headless Chrome.
- A page shall be treated as a hierarchy of nested elements and UI controls.
- Any visible element that contributes to the discovered path or flow shall be eligible to become an entity.
- Plain text-bearing containers such as `div`, `section`, `fieldset`, `mat-card`, and similar elements shall be represented when they matter to the discovered hierarchy or flow.
- The browser layer shall detect newly appearing or disappearing elements after every interaction.
- The browser layer shall not assign semantic meaning beyond directly observable structural facts.

## 2. Adapter Layer

- Each UI control or framework-specific component type shall be parsed by a dedicated adapter.
- An adapter shall convert framework/DOM-specific structure into a canonical structural representation.
- Adapters shall return a canonical entity when they understand the element.
- Adapters shall return empty when they do not understand the element.
- Framework-specific representations such as native radio, Angular Material radio, native select, `mat-select`, ARIA controls, buttons, and links shall map into common canonical control types.
- Adapter logic shall not know about workflows, graph traversal, user goals, domains, or LLM semantics.
- Adapter failure shall never silently produce misleading labels or identities.
- Unsupported or partially understood controls shall be logged with enough structural context to implement a new adapter later.

## 3. Canonical Structural Entity Layer

- Every discovered page element shall be normalized into the same generic node/entity structure.
- An entity shall have a stable identity, type discriminator, structural representation, semantic representation, and graph relationships.
- Pages, containers, UI controls, logical groups, modal roots, links/navigation controls, workflow entities, and meaningful informational elements shall all use this same node shape rather than separate domain-specific object models.
- Canonical structural properties shall include observable facts such as label, name, role, tag, URI, visibility, enabled state, hierarchy, control type, and finite option-domain metadata where structurally discoverable.
- Current user/browser-filled values shall not be canonical structural properties; concrete values belong only in runtime/instance state.
- Structural representation shall remain independent of framework-specific DOM implementation.
- Core entities shall never become ITR-specific, travel-specific, banking-specific, or otherwise domain-specific classes. Domain meaning shall be learned as semantic properties on generic entities.

The common entity shape is conceptually:

```js
{
  id,
  type,
  name,
  structural: {},
  semantic: {},
  links: []
}
```

## 4. Orchestrator Layer

- The orchestrator shall coordinate DOM capture, adapter selection, hierarchy construction, group inference, graph reconciliation, and interaction.
- The orchestrator shall try applicable adapters and use the first valid canonical representation returned.
- The orchestrator shall log an implementation gap when no adapter can validly parse a discovered control.
- The orchestrator shall rebuild the currently visible canonical hierarchy after each interaction.
- The orchestrator shall compare the new visible hierarchy with the previous state.
- The orchestrator shall reuse existing graph entities whenever the same page or element is recognized.
- The orchestrator shall add only newly discovered entities and relationships to the existing graph.
- Structural graph knowledge shall be preferred over LLM reasoning whenever sufficient.

## 5. Page Hierarchy

- A page entity shall contain a hierarchy of child entities representing the visible page structure.
- Parent-child or contains/partOf relationships shall preserve meaningful nesting between entities.
- UI controls may occur at any depth within the page hierarchy.
- Containers shall remain entities when they provide context or participate in the discovered path.
- The graph shall preserve hierarchy across repeated visits to the same page.

## 6. Logical UI Groups

- The orchestrator shall infer logical groups of related UI controls.
- A logical group shall itself be represented using the same generic entity/node structure as every other entity.
- Group entities shall link their member entities explicitly rather than creating a separate parallel representation.
- Group relationships/rules shall support concepts such as `AND`, `OR`, exactly-one, any-of, all-of, zero-or-more, and at-least-one as appropriate to the discovered UI structure.
- A radio group is therefore simply a group entity with an exactly-one rule linked to its member controls; a checkbox group may use zero-or-more or another applicable rule.
- Groups may also represent related fields that jointly form one logical question or alternative paths that satisfy one requirement.
- Group inference shall use control structure, hierarchy, shared names, accessibility relationships, and other structural evidence.
- Individual adapters shall parse controls while the orchestrator shall infer relationships between controls.

## 7. Entity Graph

- The entity graph shall be the persistent shared map of discovered application structure and semantics.
- Pages, containers, controls, groups, modals, links, workflows, and other meaningful discovered nodes shall all be entities in the graph.
- Structural and semantic information shall coexist on the same entity rather than in separate parallel representations.
- Entity relationships shall include contains, partOf, membership/group relationships, transitionsTo, and dynamic-child relationships.
- The graph shall accumulate knowledge across multiple user queries and exploration runs.
- A user query shall traverse the shared graph rather than own a private copy of the page structure.
- Revisiting an existing page shall reuse the existing page graph and enrich it with newly uncovered entities.

## 8. Dynamic UI State

- Every user or model interaction shall be treated as potentially changing the visible page state.
- The current visible state shall be preserved before an interaction is performed.
- Newly revealed inline elements shall be added to the graph without duplicating the base page.
- Newly revealed elements shall retain their normal structural parent-child relationships.
- Newly revealed elements shall also be linked causally to the entity and value/action that triggered them.
- A dynamic-child relationship shall record the trigger entity and triggering value or action.
- Different trigger values may reveal different dynamic children from the same control.
- Disappearing UI shall change runtime visibility state without deleting previously learned graph knowledge.

## 9. Stack / Context Frames

- Runtime exploration state shall be managed using stack-frame style push/pop behavior.
- The base page state shall form the initial context frame.
- A modal popup shall push a new frame while preserving the underlying page frame.
- Nested modals shall push additional frames.
- Closing a modal shall pop its frame and restore the previous frame.
- Inline dynamic expansion may create a derived runtime frame while preserving the prior state.
- Stack frames shall represent temporary runtime state and shall not duplicate persistent page graphs.
- Only the active top frame shall be interactable when a blocking modal is present.
- Navigation to a genuinely new page shall unwind modal state appropriately and transition to the new page context.

## 10. Dynamic Relationships

- Dynamic relationships shall be persistent graph knowledge rather than duplicated page-state entities.
- A dynamic relationship shall identify the triggering entity.
- A dynamic relationship shall identify the triggering value or action.
- A dynamic relationship shall identify the newly revealed target entity.
- The same entity may have multiple dynamic-child relationships for different values or actions.
- Trigger conditions shall be stored on relationships rather than represented as duplicated page-state entities.

## 11. Link / Navigation Entities

- Every relevant link or navigation control shall be represented as an entity.
- Link entities shall preserve their label, URI/route, visibility, enabled state, and structural location.
- Links shall remain children of the page or container in which they appear.
- Once a destination is known, a link shall be connected to the corresponding page entity using a transitionsTo relationship.
- Unknown link destinations may initially retain only their URI until the destination page is discovered.
- Permanent navigation such as home, help, profile, logout, or site navigation shall be identifiable as global.
- Informational links shall be distinguishable from workflow navigation links.
- Back and forward roles shall be determined relative to the active workflow rather than treated as globally intrinsic properties of the link.

## 12. Workflow Layer

- Every user query or goal shall create or identify a workflow entity.
- The workflow entity shall preserve the original user question, goal, and relevant context.
- A workflow shall reference the pages and entities traversed while accomplishing that goal.
- Workflow traversal order shall be stored separately from shared page structure.
- A page may participate in multiple workflows at different positions.
- Page ordering shall therefore be associated with workflow traversal rather than the page entity itself.
- Ordered workflow steps shall carry sequence numbers.
- Workflow sequence numbers shall represent the discovered order of pages for that specific user goal.

## 13. Workflow-Relative Navigation

- Navigation classification shall use the active workflow and page sequence where possible.
- A link targeting a lower workflow sequence shall be classified as back.
- A link targeting a higher workflow sequence shall be classified as forward.
- Repeated permanent navigation shall be classified as global where structurally supported.
- Non-workflow links may be classified as informational.
- Unknown navigation targets shall remain unresolved until followed or semantically classified.
- When all required fields on a page are satisfied, the orchestrator shall evaluate remaining navigation entities to continue the workflow.
- Known forward links shall be preferred over model-based navigation decisions.
- The LLM shall be used only when graph and structural evidence cannot determine the appropriate continuation.

## 14. Page Reuse and Incremental Discovery

- Page identity shall be stable enough to recognize an already discovered page across different workflows.
- Existing page entities shall be reused when a later query reaches the same page.
- Existing child entities shall be matched and reused where possible.
- Newly visible controls or containers shall be added to the existing page graph.
- New relationships shall enrich the existing graph rather than create duplicate page structures.
- A later workflow may reveal portions of a page that earlier workflows never explored.
- Partial exploration shall therefore be valid and expected.

## 15. Instance Graph

- The instance graph shall hold concrete values associated with canonical entities.
- The instance graph shall normally be a sparse subset mirror of the entity graph.
- Instance entities shall reference their corresponding structural entities.
- Instance values shall not duplicate structural or semantic definitions.
- Stored values may be reused when revisiting the same entity where valid.
- Runtime instance state shall remain separate from persistent application structure.

## 16. Interaction / Execution Layer

- Browser execution shall operate only on canonical entities.
- Manual mode shall obtain required values from the user.
- Run mode shall use user-provided or stored values.
- Learn mode shall allow the model to propose values from safe structural and semantic context.
- Browser interaction shall resolve canonical entities back to executable DOM controls.
- Every applied value or action shall trigger a fresh visible-state capture.
- Execution logic shall not contain independent UI interpretation rules that duplicate the adapter layer.

## 17. LLM / Semantic Layer

- The LLM shall enrich canonical entities with semantic interpretation.
- Semantic properties shall be stored on the same persistent entity as structural properties.
- The LLM shall interpret business meaning, relevance to goal, requiredness, workflow purpose, and unresolved navigation intent.
- The LLM shall not be used to rediscover facts already deterministically available from structure or graph history.
- Existing semantic knowledge shall be reused across workflows where appropriate.
- Query-specific semantic context may reference the active workflow without changing globally shared structural facts.
- Model requests shall be compact, scoped to unresolved or decision-relevant entities, and shall not send the whole graph merely because it exists.

## 18. Failure and Diagnostics

- Unsupported UI structures shall be explicitly logged.
- Invalid adapter output shall be rejected rather than silently accepted.
- Missing labels, unresolved controls, and unknown navigation structures shall remain visible implementation gaps.
- Diagnostics shall capture only explicitly safe structural/runtime metadata sufficient to create a new adapter or parser regression test.
- Diagnostics shall not log raw DOM values, prompts, instance values, or arbitrary error payloads that could contain private data.
- The system shall prefer an explicit unknown state over an incorrect inferred structural representation.
- Every newly supported UI pattern shall have a regression test.

## 19. Core Simplicity Rule

- UI-specific parsing belongs only in adapters.
- Cross-element structural reasoning belongs only in the orchestrator.
- Persistent application knowledge belongs only in the entity graph.
- Concrete runtime values belong only in the instance graph.
- Query-specific order and context belong only in the workflow layer.
- Semantic interpretation belongs only in the LLM/semantic layer.
- Browser actions belong only in the execution layer.
- Temporary visible state belongs only in context stack frames.
- Logic outside these boundaries shall be removed or relocated rather than allowed to create parallel representations or heuristic pipelines.

## 20. Privacy and User Values

- User-provided values shall never be transmitted to the LLM.
- Stored instance values shall never be transmitted to the LLM.
- Values read from filled browser fields shall never be transmitted to the LLM.
- Sensitive values such as passwords, tax identifiers, account numbers, addresses, income values, and other personal data shall remain local.
- Model requests shall contain only structural entities, sanitized labels, semantic context, finite choice metadata when safe, and information explicitly safe for model use.
- The semantic layer shall operate on entity meaning and structure without requiring concrete user values.
- Learn mode may ask the model to propose a value only from safe structural/context information and shall not expose existing private values as context.
- User values shall never be written to query logs, model logs, debug logs, or diagnostic output.
- Instance graph persistence shall store values only in the designated local instance store.
- Diagnostic logging shall record entity IDs, control types, actions, and state transitions without recording actual user-entered values.
- Logs may record that a value was supplied, reused, or applied but shall represent the value as redacted rather than recording its contents.
- DOM diagnostics for unsupported controls shall redact current field values before being written.
- Browser snapshots retained for diagnostics shall exclude or redact input values.
- Model-call logging shall record safe metadata such as purpose, token usage, duration, and stable error codes without recording private user values.
- Privacy filtering shall happen before data crosses the model boundary rather than relying on the model to ignore sensitive values.
- When a value cannot safely be separated from structural context, that content shall not be sent to the model.
- Runtime/user value transmission to external model services shall be deny-by-default.

## 21. Configuration / `.env` Layer

- Runtime configuration shall be centralized through environment variables loaded from `.env`.
- Source code shall not contain deployment-specific paths, endpoints, credentials, or model configuration.
- `.env` shall configure the Chrome/CDP connection used by the browser execution layer.
- `.env` shall configure model provider, model name, and model endpoint where applicable.
- API keys and other credentials shall exist only in environment configuration and shall never be committed to the repository.
- `.env` shall configure entity graph storage location.
- `.env` shall configure instance graph storage location.
- `.env` shall configure workflow/run log storage location.
- `.env` shall configure browser interaction and structural settlement timing where required.
- `.env` shall configure maximum exploration steps and other runtime limits.
- `.env` shall configure execution mode such as manual, run, or learn mode.
- `.env` shall configure diagnostic verbosity and development logging where needed.
- Privacy behavior shall be safe by default and shall not require an environment flag to prevent user-value transmission or logging.
- Security/privacy guarantees shall not be disableable through ordinary debug configuration.
- Optional framework adapters may be enabled or configured through environment settings only where there is a genuine deployment need.
- Environment parsing and validation shall be contained in a single configuration module.
- All layers shall consume typed/validated configuration from the configuration module rather than reading `process.env` independently.
- Missing required configuration shall fail early with a clear startup error.
- Invalid environment values shall fail validation rather than silently falling back to unsafe or unexpected behavior.
- Non-secret defaults may be defined in code while secrets and machine-specific configuration remain in `.env`.
- A `.env.example` file shall document supported configuration keys without containing credentials or private values.

## Architectural Flow

```text
Headless Chrome / Visible DOM
        ↓
UI Adapter Layer
        ↓
Generic Canonical Nodes / Entities
        ↓
Orchestrator
  ├─ page hierarchy
  ├─ logical group entities + AND/OR/cardinality rules
  ├─ dynamic-child discovery
  ├─ context stack
  ├─ graph reconciliation
  └─ navigation resolution
        ↓
Entity Graph ←→ Workflow Traversal
        ↓              ↓
Semantic / LLM      sequence + query context
        ↓
Instance Graph
        ↓
Execution Layer
        ↓
Headless Chrome
```

## Implemented v2 Layer Map

The v2 implementation was built incrementally. The implementation-layer numbering below describes the construction sequence; it refines the architectural responsibilities above rather than creating 26 unrelated architectural concepts.

1. **Browser / DOM** — captures the visible hierarchy and safe structural attributes without browser-entered values.
2. **Adapters** — maps native, Angular Material, and ARIA controls into common control representations; framework vocabulary stops here.
3. **Canonical Entity** — produces stable generic entities using the common `{id,type,name,structural,semantic,links}` shape.
4. **Orchestrator** — walks the captured hierarchy and canonicalizes relevant nodes through adapters.
5. **Page Hierarchy** — materializes persistent `contains` / `partOf` structure without flattening meaningful nesting.
6. **Logical Groups** — creates group entities and links member controls using cardinality/logical rules such as exactly-one, AND, or OR.
7. **Entity Graph** — persists shared application structure and semantic enrichment on the same entities.
8. **Dynamic Reconciliation** — compares post-action visibility with previous state, retains hidden learned nodes, and records newly revealed branches.
9. **Context Stack** — maintains page/modal/dynamic runtime frames with push/pop semantics and active visibility/actionability.
10. **Navigation** — represents navigation controls as entities and learns `transitionsTo` relationships when destinations become known.
11. **Workflow Traversal** — records ordered query-specific page traversal separately from shared application structure.
12. **Instance Graph** — stores concrete local values/references as a sparse mirror keyed to structural entity IDs.
13. **Interaction Execution** — resolves canonical control entities into concrete browser actions such as fill/select/check/click.
14. **Privacy Boundary** — removes runtime/user-value fields before any model boundary and rejects unsafe model payloads.
15. **Model Gateway** — provides a narrow transport interface that accepts only approved compact operations/payloads.
16. **Configuration** — centralizes browser, model, storage, runtime, and privacy-safe defaults through validated configuration.
17. **Diagnostics attempt deferred** — an early permissive logger design was rejected rather than carried forward.
18. **Page Reuse** — reuses known page/entity identities across revisits and incrementally adds newly discovered branches.
19. **Run Coordinator** — composes capture materialization, hierarchy/groups, page reuse, reconciliation, workflow, and frame updates.
20. **Semantic Resolver / Compact Model Protocol** — selects only unresolved scoped entities, builds compact semantic/navigation requests, and merges whitelisted semantic patches.
21. **Agent Decision** — chooses the next required input, reusable known input, relevant navigation candidate, or completion state.
22. **Decision Execution** — converts logical decisions (including group choices) back into concrete control execution and local instance updates.
23. **Safe Diagnostics** — records only allowlisted event metadata such as IDs, counts, durations, steps, and stable error codes.
24. **Persistence** — loads/saves entity graph, instance graph, and workflow state with explicit validation and safe checkpointing.
25. **Application Runner** — runs the observe → understand → decide → act → recapture → reconcile → checkpoint loop.
26. **Browser Bootstrap / Entrypoint** — connects to Chrome via CDP, selects a page, loads configuration/state/model transport, invokes the runner, and closes only the LeMap connection.

The implementation flow can therefore be summarized as:

```text
SEE
↓
STRUCTURE
↓
UNDERSTAND
↓
DECIDE
↓
ACT
↓
SEE AGAIN
```

## End-to-End Example: First Page of an ITR-3 Flow

This example is illustrative only. **Nothing in the LeMap Web core is specific to ITR-3.** The exact same node model and processing layers must work unchanged for a flight-booking page, hotel-booking page, banking workflow, insurance form, or another application.

Assume the first visible page conceptually contains:

```text
Filing Status
  Are you filing under a particular provision?
    ○ Yes
    ○ No

Next
```

### 1. Observe the DOM

The browser layer captures a neutral hierarchy such as:

```text
body
  section
    radio-group
      radio "Yes"
      radio "No"
  button "Next"
```

The browser layer does not decide that this is a tax field and does not capture a current user answer as graph structure.

### 2. Adapt Framework Controls

If the page uses Angular Material, the adapter may recognize `mat-radio-group` / `mat-radio-button`; another site may use native inputs or ARIA widgets. All are converted into generic controls:

```text
radio "Yes"
radio "No"
button "Next"
```

Framework-specific vocabulary ends at the adapter boundary.

### 3. Build Generic Entities

Canonicalization creates generic nodes. Their IDs are stable structural identities; names below are explanatory labels, not domain-specific classes:

```text
node A  type=page
node B  type=container
node C  type=ui_control   name="Yes"
node D  type=ui_control   name="No"
node E  type=ui_group
node F  type=ui_control   name="Next"
```

All use the same entity shape:

```js
{
  id,
  type,
  name,
  structural: {},
  semantic: {},
  links: []
}
```

### 4. Infer Hierarchy and Group Relationships

The entity graph can represent:

```text
A contains B
B contains E
E hasMember C
E hasMember D
A contains F
```

The radio group is not a special tax object. It is a generic group entity whose structural/logical rule says that exactly one member may be selected:

```text
E
  type = ui_group
  rule = exactly-one
  members = [C, D]
```

Other applications can use the same group entity mechanism for `AND`, `OR`, any-of, all-of, or other cardinality rules. For example, a travel site may group `From + To + Departure Date` using an AND relationship, while alternate identity methods may form an OR relationship.

### 5. Persist Shared Application Structure

The entity graph stores the learned page, container, group, controls, hierarchy, and later semantics. At this point it still need not know that the group means "filing status".

### 6. Learn Semantic Meaning Compactly

The semantic resolver selects only unresolved relevant entities and sends compact safe context to the model. A request may conceptually contain:

```js
{
  query: "File my return",
  currentPage: { id: "...", name: "..." },
  entities: [
    {
      id: "...",
      type: "ui_group",
      name: "Are you filing under a particular provision?",
      cardinality: "exactlyOne",
      choices: ["Yes", "No"]
    }
  ]
}
```

It does **not** send the entire entity graph, the instance graph, current browser-filled values, selectors, framework classes, PAN/income/account data, or other private runtime values.

The model may return semantic enrichment such as:

```js
{
  interaction: "user_input",
  relevantToGoal: true,
  required: true,
  question: "Are you filing under this provision?",
  meaning: "Determines the applicable filing path.",
  selectionRule: "exactlyOne"
}
```

That semantic information is merged onto the same group entity. No parallel semantic object is created.

### 7. Decide What to Do Next

The decision layer asks whether there is a visible, enabled, required, goal-relevant input that has no local instance value. If the group is unresolved, it becomes the next logical question.

The user may answer:

```text
No
```

### 8. Execute the Logical Decision

The decision-execution bridge resolves logical choice `No` from the group entity to the concrete member control entity and invokes browser execution.

The browser action is against the concrete control, but the local instance graph stores the logical value against the group entity:

```js
{
  entityId: "<group entity id>",
  value: "No"
}
```

The selected value remains local and is not added to persistent application structure or sent to the model.

### 9. Recapture and Learn Dynamic State

Suppose selecting `No` reveals another section:

```text
Reason for filing
  ○ Income above threshold
  ○ Foreign assets
  ○ Other
```

The application runner captures the page again. Because page identity has not changed, dynamic reconciliation compares the new visible hierarchy with the prior one.

The new section and controls become new generic entities attached to the same page graph. LeMap retains both normal containment and causal knowledge such as:

```text
triggering control/value
        ↓ dynamicChild / revealedBy
newly revealed section/group
```

The base page is not duplicated for each dynamic state.

### 10. Continue or Navigate

Once required goal-relevant inputs on the active page are satisfied, the decision layer evaluates navigation controls. `Next` is simply another generic `ui_control` entity with navigation semantics.

Execution clicks it, the browser is recaptured, and if canonical page identity changes the coordinator ingests a new page visit rather than treating it as an inline reveal.

The workflow traversal can then record:

```text
Step 1: first page
Step 2: second page, entered via the Next entity
```

while the shared entity graph learns:

```text
NextEntity transitionsTo SecondPageEntity
```

The workflow sequence is query-specific; the page entities remain shared reusable application knowledge.

### 11. Separation of the Three Core Graph/Traversal Concerns

At this point LeMap maintains three deliberately separate concerns:

```text
ENTITY GRAPH
What the application is
(structure + learned semantics)

WORKFLOW TRAVERSAL
How this particular goal moved through the application
(ordered page/entity traversal)

INSTANCE GRAPH
What concrete values this run/user supplied
(local runtime values/references)
```

This separation is what allows a later run to reuse the learned application map without exposing or mixing prior user values.

### 12. Same Engine on a Travel-Booking Website

A travel site might expose:

```text
Search Form
  From
  To
  Departure Date
  Return Date
  Travellers
  Search

Fare Type
  Regular
  Student
  Senior Citizen
```

LeMap Web must process it with the exact same primitives:

```text
page node
container nodes
ui_control nodes
group nodes
contains / partOf / hasMember relationships
AND / OR / cardinality rules
semantic enrichment
workflow traversal
instance values
navigation transitions
```

There shall be no core `FlightSearchEntity`, `AirportEntity`, `TaxFilingEntity`, or similar domain-specific class. Concepts such as "departure airport", "fare type", or "filing status" are learned semantic meaning attached to generic entities.

## Governing Principle

LeMap Web shall remain simple by keeping framework-specific parsing in adapters, cross-element reasoning in the orchestrator, persistent structural and semantic knowledge in the entity graph, concrete private values in the local instance graph, query-specific order in workflows, temporary state in stack frames, model reasoning in the semantic layer, and browser actions in the execution layer.

The core understands **generic nodes, relationships, groups, state, and traversal**. The semantic layer learns what those nodes mean in a particular business domain.