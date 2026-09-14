# Odoo Execution Bridge Design

## Goal

Make Odoo participate in LeMap workflow reconstruction the same way Moqui does: framework-specific evidence is translated into the generic semantic execution graph, and the existing CallPathIndexer / Pass 1 / Pass 2 machinery reconstructs end-to-end business flows.

## Core decision

Odoo workflow discovery is path-driven, not entity-neighborhood-driven.

```text
ACME project method / override
        ↓
Odoo execution adapter
        ↓
resolve super() / Odoo method calls
        ↓
generic LeMap calls / reads / writes
        ↓
CallPathIndexer
        ↓
Pass 1 / Pass 2
        ↓
end-to-end workflow + touched entities
```

The adapter does not create a second Odoo workflow engine. It only converts Odoo Python semantics into the same generic topology that already supports Moqui execution evidence.

## Scope

The first execution slice handles Python model methods in ACME custom addons and targeted official Odoo 19 model files. It recognizes:

- model identity from `_name` / `_inherit`;
- method definitions;
- `super().method(...)` calls;
- `self.method(...)` calls;
- `self.env['model.name'].method(...)` calls;
- obvious ORM `create`, `write`, `unlink`, `search`, `browse`, `read`, `mapped`, and `filtered` operations;
- source provenance and framework/project ownership.

The initial bridge is deliberately deterministic and bounded. It follows only framework methods reached from ACME methods or from already-followed Odoo methods. It does not index all Odoo methods up front.

## Method identities

Project method symbol names use:

```text
odoo-project:<model>.<method>
```

Framework method symbol names use:

```text
odoo19:<model>.<method>
```

Qualified references are used for cross-layer calls so the existing topology resolver can resolve them without ambiguous same-name matching.

Example:

```text
odoo-project:mrp.production.action_confirm
    -[calls]->
odoo19:mrp.production.action_confirm
    -[calls]->
odoo19:mrp.production._create_moves
```

## Targeted framework loading

The adapter starts from ACME project methods. When a project method overrides a standard model method and calls `super().foo()`, the adapter resolves the standard model source from the existing Odoo source cache, parses only matching model files, materializes `foo`, then recursively materializes methods that `foo` calls on `self` or explicit Odoo model proxies.

Limits:

- maximum framework call depth: 6;
- maximum framework methods materialized per run: 250;
- only modules in the existing Odoo module dependency closure are eligible;
- unresolved calls remain external call terminals rather than triggering broad source scans.

## Reads and writes

Execution edges remain generic:

- method invocation → `calls`;
- ORM reads/search/browse/read/mapped/filtered → `reads` reference to model;
- ORM create/write/unlink → `writes` reference to model.

Entity references are evidence attached to actual execution paths. They no longer determine the workflow traversal frontier.

## Interaction with the framework schema map

The reusable Odoo schema map remains valid and can continue to accumulate framework schemas. The execution bridge does not delete those 53 learned schemas.

For ACME workflow exploration, the active semantic path is driven by method execution. Framework schemas support entity resolution and query interpretation when a method path touches them.

## Integration point

`createOdooAdapters(topology)` gains an `execution` adapter, parallel to Moqui:

```text
Moqui adapters
  entitySchema
  execution

Odoo adapters
  entitySchema
  frameworkEnricher
  execution
```

On the Odoo branch of `ProgressiveRepositoryTopologyV9.prepare()`:

1. extract ACME project schemas;
2. enrich/reuse framework schemas;
3. run Odoo execution augmentation;
4. reindex symbols and rebuild callers;
5. build the existing `CallPathIndexerV3` snapshot.

No change is made to the non-Odoo/Moqui path.

## Success criteria

A real ACME EMS run should prove at least one path that begins in a custom ACME model method and crosses into an official Odoo 19 base method. The resulting call path must be visible through the existing `topCallPaths()` / `callPathScoutCandidates()` APIs without a special Odoo-only workflow API.

Unit tests must cover parsing, super-call resolution, self-call resolution, targeted framework loading, bounded recursion, and preservation of the Moqui test suite.

## Out of scope

This slice does not attempt perfect Python AST interpretation, dynamic monkey-patching, decorators that alter dispatch semantics, arbitrary runtime reflection, XML view/action execution, or semantic interpretation of the final workflow. Those can be added incrementally after the deterministic Python execution bridge is proven on ACME EMS.
