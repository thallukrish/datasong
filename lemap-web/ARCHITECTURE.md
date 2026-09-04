# LeMap-Web Architecture

## 1. Core idea

LeMap-Web builds one **entity graph** describing the web application and one separate **instance graph** describing what a user has filled.

The entity graph is the application model.

The instance graph is user/runtime data.

The three contributors are deliberately separated:

- **LeMap-Web** adds structural facts.
- **The model** adds semantic facts.
- **The user** adds instance values.

They advance the same conceptual application graph without mixing ownership.

---

## 2. Entity graph

The entity graph is an array of entity nodes.

Every meaningful UI object is an entity node, including:

- page
- field
- button
- link
- dropdown
- radio control
- checkbox
- group
- modal
- popup
- dynamically expanded section
- workflow

A node has a stable id and contains structural details, semantic details and links.

Conceptually:

```json
{
  "id": "entity:assessment-year",
  "name": "Assessment Year",
  "type": "ui_control",
  "structural": {},
  "semantic": {},
  "links": []
}
```

The graph itself is simply:

```text
entities[]
```

Relationships are represented through each node's `links[]` array.

---

## 3. Structural details

Structural facts are owned by LeMap-Web and come from deterministic browser/DOM inspection.

Typical structural properties are:

```text
control type
DOM tag / role
label
name
current/default value
available values/options
visible / hidden
enabled / disabled
checked / selected
required / readonly
route / location
DOM or page containment
group membership
```

Example:

```json
{
  "id": "entity:assessment-year",
  "name": "Assessment Year",
  "type": "ui_control",
  "structural": {
    "controlType": "dropdown",
    "values": ["Select", "2026-27", "2025-26"],
    "defaultValue": "Select",
    "visible": true,
    "enabled": true
  }
}
```

Option values such as `2026-27`, `Online`, `Offline`, countries, cities, etc. are values of a control entity. They are not separate entity nodes merely because they are selectable values.

---

## 4. Semantic details

Semantic facts are owned by the model.

The model receives the structural entity graph relevant to the current context plus the user goal and returns only semantic additions.

Semantic properties are optional and may include:

```text
business meaning
semantic type such as country / city / address / assessment year
local or global scope
user-filled input vs informational content
relevance to the user goal
workflow role
question to ask the user
explanation
examples
caveats
requiredness
other user-facing interpretation
```

Example:

```json
{
  "semantic": {
    "meaning": "assessment year",
    "scope": "local",
    "kind": "user_input",
    "question": "For which assessment year do you want to file?",
    "explanation": "The assessment year identifies the filing period."
  }
}
```

The model does not need to repeat structural details already known to LeMap-Web.

---

## 5. Links and relationships

Each entity has a `links[]` array.

Each link object contains at least:

```text
target entity id
relationship
```

Example:

```json
{
  "links": [
    {
      "id": "entity:file-return-page",
      "relationship": "childOf"
    }
  ]
}
```

Relationships are bidirectional.

If a page contains a field:

```text
Page --contains--> Field
Field --childOf--> Page
```

If a control belongs to a group:

```text
Group --contains--> Control
Control --partOf--> Group
```

If a page belongs to a workflow:

```text
Workflow --contains--> Page
Page --partOf--> Workflow
```

---

## 6. Groups are entities

A UI group is an entity node.

Example:

```text
[Page]
   |
   | contains
   v
[Filing Mode Group]
   |                |
   | contains       | contains
   v                v
[Online radio]   [Offline radio]
```

Reverse links also exist:

```text
[Online radio]  --partOf--> [Filing Mode Group]
[Offline radio] --partOf--> [Filing Mode Group]
```

The group entity may itself carry structural and semantic details.

---

## 7. Pages are entities

A rendered page is an entity.

It links to the controls, groups, buttons, links and other child entities it contains.

Example:

```text
[Page: File Income Tax Return]
        |
        +--contains--> [Assessment Year]
        |
        +--contains--> [Filing Mode Group]
        |                  |
        |                  +--contains--> [Online radio]
        |                  +--contains--> [Offline radio]
        |
        +--contains--> [Continue button]
```

The page entity carries structural page details and model-added semantic meaning.

---

## 8. Workflows are entities

A workflow is also an entity node.

```json
{
  "id": "workflow:file-return",
  "name": "File Return",
  "type": "workflow",
  "structural": {},
  "semantic": {},
  "links": []
}
```

The workflow entity links the page/state entities whose transitions make up the workflow.

Example:

```text
[Workflow]
   |
   +--contains--> [Page A]
   +--contains--> [Page B]
   +--contains--> [Page C]
```

Buttons or links that transition between pages connect the relevant entities.

For example:

```text
[Continue button] --transitionsTo--> [Next Page]
[Next Page]       --reachedFrom----> [Continue button]
```

The model supplies the semantic workflow role of controls; LeMap-Web supplies the structural evidence that a transition actually occurred.

---

## 9. Dynamic UI is still entity graph

Anything that appears dynamically is represented in the entity graph exactly like initially visible UI.

Examples:

```text
popup
modal
inline expansion
conditional field
new group
new section
```

If modifying one field exposes a new field:

```text
[Source Field]
      |
      | onModification
      v
[Newly Appeared Field]
```

The new UI object becomes a new entity with its own structural and semantic details.

The triggering relationship is preserved in links.

---

## 10. Changed entity state creates another entity state node

The entity graph preserves observed application states rather than overwriting history.

If modifying Field X changes another existing UI entity, create a new entity node representing the changed state.

Example:

```text
[Continue button: disabled]
          |
          | copiedAs / changedTo
          v
[Continue button: enabled]
```

The changed-state node also links to the triggering field:

```text
[Field X]
    |
    | onModification
    v
[Continue button: enabled]
```

Likewise, if a field's structural value/default changes, the new observed state becomes another entity node linked back to its prior version.

This preserves causal UI behavior in the graph.

---

## 11. Instance graph

User-filled values are not stored in the entity graph.

They are stored in a separate instance array.

An instance node contains the actual user value and references the corresponding entity through an `instanceOf` link.

Example:

```json
{
  "id": "instance:1",
  "type": "instance",
  "value": "2026-27",
  "links": [
    {
      "id": "entity:assessment-year",
      "relationship": "instanceOf"
    }
  ]
}
```

Another example:

```json
{
  "id": "instance:2",
  "type": "instance",
  "value": "Online",
  "links": [
    {
      "id": "entity:filing-mode",
      "relationship": "instanceOf"
    }
  ]
}
```

Conceptually:

```text
[Instance: 2026-27] --instanceOf--> [Assessment Year]
[Instance: Online]  --instanceOf--> [Filing Mode]
```

There is no need to mutate the entity's semantic meaning with the user's actual value.

---

## 12. Entity values versus instance values

The two graphs have different meanings.

The entity graph may contain:

```text
default values
current observed UI values
option domains
control state
semantic interpretation
```

The instance graph contains:

```text
actual user-provided values
```

The two may happen to contain the same literal value at some moment, but they remain separate facts.

Example:

```text
Entity graph:
Assessment Year default/current UI value = 2026-27

Instance graph:
User supplied value = 2026-27
```

Those are different records with different ownership.

---

## 13. Persistence

The entity graph and instance graph are persisted separately.

Conceptually:

```text
entity-graph.json
  entities[]

instance-graph.json
  instances[]
```

At runtime they can be loaded into memory together because instance nodes reference stable entity IDs.

The persisted separation is important:

- reusable application knowledge stays reusable;
- user-specific values stay isolated;
- semantic learning never needs to absorb private instance values.

---

## 14. Model interaction

For a newly encountered page or state, LeMap-Web first creates structural entity nodes and structural links.

Then the model receives the relevant structural entity graph plus the current user goal.

The model returns semantic additions only.

The model identifies, among other things:

```text
which entities are user-facing
which are relevant to the current goal
which are local vs global
which require user input
which are informational
what questions/explanations/caveats/examples belong to them
which controls continue the workflow
```

LeMap-Web merges those semantic additions into the existing entity nodes.

---

## 15. Responsibility boundary

The governing ownership model is:

```text
LeMap-Web
  → structure
  → UI state
  → relationships proven from the browser
  → actual transitions

Model
  → meaning
  → local/global interpretation
  → workflow role
  → user-facing explanation/question/examples/caveats
  → relevance to the user goal

User
  → actual values
  → instance nodes only
```

This is the central architecture.

---

## 16. Page-1 strawman

Entity graph:

```text
[Workflow: File ITR-3]
        |
        | contains
        v
[Page: File Income Tax Return]
        |
        +--contains--> [Assessment Year]
        |                 structural.controlType: dropdown
        |                 structural.values: [Select, 2026-27, 2025-26, ...]
        |                 semantic.meaning: assessment year
        |                 semantic.scope: local
        |                 semantic.kind: user_input
        |
        +--contains--> [Filing Mode Group]
        |                  |
        |                  +--contains--> [Online radio]
        |                  +--contains--> [Offline radio]
        |                  |
        |                  semantic.meaning: filing mode
        |
        +--contains--> [Continue button]
                          structural.controlType: button
                          semantic.workflowRole: continue
```

Reverse relationships:

```text
Assessment Year    --childOf--> Page
Filing Mode Group  --childOf--> Page
Online radio       --partOf----> Filing Mode Group
Offline radio      --partOf----> Filing Mode Group
Continue button    --childOf--> Page
Page               --partOf----> Workflow
```

Instance graph after the user chooses `2026-27` and `Online`:

```text
[Instance: 2026-27]
    --instanceOf--> [Assessment Year]

[Instance: Online]
    --instanceOf--> [Filing Mode / selected control entity]
```

---

## 17. End-to-end invariant

The architecture can be summarized as:

```text
Browser appears
→ LeMap-Web creates/updates structural entities and links
→ model adds semantic meaning to those same entities
→ relevant user input is requested
→ user answer becomes a separate instance node
→ LeMap-Web applies the instance value to the browser
→ newly appearing or changed UI creates new entity/state nodes and causal links
→ model adds semantics only for newly discovered meaning
→ workflow entity accumulates page/state relationships
→ repeat
```

The invariant is:

> **The entity graph describes what the application is and how it behaves. The instance graph describes only what the user filled. LeMap-Web, the model and the user each write to their own layer while sharing stable entity IDs and relationships.**
