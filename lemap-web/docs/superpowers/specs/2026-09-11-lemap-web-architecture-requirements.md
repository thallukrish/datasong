# LeMap Web Architecture Requirements

## Purpose

LeMap Web shall use a small number of clean layers with explicit responsibilities: browser/DOM capture, UI adapters, canonical structural entities, orchestration, entity graph, instance graph, workflow traversal, semantic/LLM interaction, browser execution, privacy, and configuration.

The architecture shall avoid parallel representations, hidden heuristic pipelines, and cross-layer logic that duplicates responsibility.

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
- Adapter logic shall not know about workflows, graph traversal, user goals, or LLM semantics.
- Adapter failure shall never silently produce misleading labels or identities.
- Unsupported or partially understood controls shall be logged with enough structural context to implement a new adapter later.

## 3. Canonical Structural Entity Layer

- Every discovered page element shall be normalized into a common canonical entity structure.
- An entity shall have a stable identity, type, structural representation, semantic representation, and graph relationships.
- Canonical structural properties shall include observable facts such as label, name, value, role, tag, URI, visibility, enabled state, and hierarchy.
- Canonical entity types shall include at least page, container, UI control, logical group, modal, link, and workflow.
- Structural representation shall remain independent of framework-specific DOM implementation.

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
- A logical group shall itself be represented as an entity.
- Group entities shall relate their member controls using contains/partOf relationships.
- Group selection rules shall support concepts such as exactly-one, any-of, all-of, and at-least-one.
- Group inference shall use control structure, hierarchy, shared names, accessibility relationships, and other structural evidence.
- Individual adapters shall parse controls while the orchestrator shall infer relationships between controls.

## 7. Entity Graph

- The entity graph shall be the persistent shared map of discovered application structure and semantics.
- Pages, containers, controls, groups, modals, links, and workflows shall all be entities in the graph.
- Structural and semantic information shall coexist on the same entity rather than in separate parallel representations.
- Entity relationships shall include contains, partOf, transitionsTo, and dynamic-child relationships.
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
- Page ordering shall therefore be associated with the workflow-page relationship rather than the page entity itself.
- Each workflow-page relationship shall carry a sequence number.
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

## 18. Failure and Diagnostics

- Unsupported UI structures shall be explicitly logged.
- Invalid adapter output shall be rejected rather than silently accepted.
- Missing labels, unresolved controls, and unknown navigation structures shall remain visible implementation gaps.
- Diagnostics shall capture enough DOM/framework context to create a new adapter or parser test.
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
- Model requests shall contain only structural entities, sanitized labels, semantic context, and information explicitly safe for model use.
- The semantic layer shall operate on entity meaning and structure without requiring concrete user values.
- Learn mode may ask the model to propose a value only from safe structural/context information and shall not expose existing private values as context.
- User values shall never be written to query logs, model logs, debug logs, or diagnostic output.
- Instance graph persistence shall store values only in the designated local instance store.
- Diagnostic logging shall record entity IDs, control types, actions, and state transitions without recording actual user-entered values.
- Logs may record that a value was supplied, reused, or applied but shall represent the value as redacted rather than recording its contents.
- DOM diagnostics for unsupported controls shall redact current field values before being written.
- Browser snapshots retained for diagnostics shall exclude or redact input values.
- Model-call logging shall record safe metadata such as purpose, token usage, duration, and errors without recording private user values.
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
Canonical Structural Entities
        ↓
Orchestrator
  ├─ page hierarchy
  ├─ logical groups
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

## Governing Principle

LeMap Web shall remain simple by keeping framework-specific parsing in adapters, cross-element reasoning in the orchestrator, persistent structural and semantic knowledge in the entity graph, concrete private values in the local instance graph, query-specific order in workflows, temporary state in stack frames, model reasoning in the semantic layer, and browser actions in the execution layer.