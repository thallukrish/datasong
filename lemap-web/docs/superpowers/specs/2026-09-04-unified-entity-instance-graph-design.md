# LeMap-Web Unified Entity / Instance Graph Design

## Status

Approved architecture direction, 2026-09-04.

This design supersedes earlier LeMap-Web designs built around separate semantic interaction plans, behavior-class abstractions and a standalone workflow graph.

## Core model

LeMap-Web maintains two persisted structures:

```text
ENTITY GRAPH
  reusable application structure + semantics + observed state relationships

INSTANCE GRAPH
  actual user-provided values only
```

The entity graph is an array of entity nodes. Each node may represent a page, UI control, group, modal, popup, dynamic section or workflow.

Each entity has:

```text
id
name
type
structural {}
semantic {}
links[]
```

Each link contains at least a target entity id and relationship.

All graph relationships are represented bidirectionally.

## Ownership

Three actors enrich different parts of the model.

```text
LeMap-Web -> structural
Model     -> semantic
User      -> instance
```

LeMap-Web owns deterministic browser facts such as control type, label, DOM role, default/current value, option domain, enabled/disabled state, visibility, containment, group membership and observed transitions.

The model owns semantic interpretation such as business meaning, semantic type, local/global classification, whether something is user input or informational, relevance to the current goal, workflow role, questions, explanations, examples and caveats.

The user owns only actual values. User values are persisted as separate instance nodes.

## Entity relationships

Examples:

```text
Page --contains--> Field
Field --childOf--> Page

Group --contains--> Control
Control --partOf--> Group

Workflow --contains--> Page
Page --partOf--> Workflow

Button --transitionsTo--> Next Page
Next Page --reachedFrom--> Button
```

A UI control that belongs to a group links both to the group and, where useful, through the page containment graph.

## Control values

Selectable values are not automatically entities.

Example:

```text
Assessment Year entity
  structural.values = [Select, 2026-27, 2025-26, ...]

Filing Mode entity/group
  structural.values = [Online, Offline]
```

The values stay properties of the relevant UI entity unless the UI itself renders them as independently meaningful controls/entities.

## Dynamic UI and causal relationships

Dynamically appearing UI is modeled in the same entity graph.

Examples include modal dialogs, popups, inline expansions, conditional fields, groups and sections.

If modifying Field X exposes a new entity:

```text
Field X --onModification--> New Entity
New Entity --appearedFrom--> Field X
```

If modifying Field X changes an existing UI object's observable state, LeMap-Web creates a new state/version entity rather than destroying the old graph state.

Example:

```text
Continue button disabled
    --changedTo-->
Continue button enabled

Field X
    --onModification-->
Continue button enabled
```

The new state entity also links back to the prior entity state through a version/copy relationship such as `copyOf`, `derivedFrom` or another final normalized relationship name chosen during implementation.

## Workflow as an entity

Workflow is not a separate graph primitive.

A workflow is an entity with:

```text
type: workflow
```

It links the page/state entities that participate in completing the workflow.

The workflow entity therefore lives in the same entity array as pages, controls and groups.

## Instance graph

The instance graph is a separate array.

An instance node contains the actual user value and an `instanceOf` relationship to the corresponding entity.

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

The entity graph may independently record default/current UI values. Even if the entity-side value equals the user-side value, they remain separate facts.

## Model exchange

For a newly discovered page/state, LeMap-Web first constructs structural entities and relationships.

The model receives the relevant structural graph plus the user goal.

The model returns semantic additions only, avoiding repetition of already-known structural details.

The semantic result is merged into the corresponding entity IDs.

Later model calls should focus only on newly discovered or semantically unresolved entities/relationships where possible.

## Page-1 strawman

```text
[Workflow: File ITR-3]
        |
        | contains
        v
[Page: File Income Tax Return]
        |
        +--contains--> [Assessment Year]
        |                 dropdown
        |                 values: [Select, 2026-27, 2025-26, ...]
        |
        +--contains--> [Filing Mode Group]
        |                  |
        |                  +--contains--> [Online radio]
        |                  +--contains--> [Offline radio]
        |
        +--contains--> [Continue button]
```

Reverse links are also present:

```text
Assessment Year   --childOf--> Page
Filing Mode Group --childOf--> Page
Online radio      --partOf----> Filing Mode Group
Offline radio     --partOf----> Filing Mode Group
Continue button   --childOf--> Page
Page              --partOf----> Workflow
```

Instance graph after user input:

```text
[Instance: 2026-27] --instanceOf--> [Assessment Year]
[Instance: Online]  --instanceOf--> [corresponding filing-mode entity]
```

## Persistence

Persist separately:

```text
entity graph -> entities[]
instance graph -> instances[]
```

At runtime they may be loaded together because instance references use stable entity IDs.

## Implementation boundary

Most of the current higher-level semantic/workflow orchestration should be replaced.

Potentially reusable low-level pieces include:

```text
HTML / DOM capture
UI-control discovery and classification
option extraction
visibility / enabled-state inspection
browser action execution
form filling / clicking
before/after capture mechanics
```

These pieces should feed the new graph model rather than preserve the old interaction-plan architecture.
