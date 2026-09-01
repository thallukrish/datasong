# DataSong demo_v2 — Current LeMap reference implementation

`demo_v2` is the current working reference implementation for LeMap learning, persistence, exploration and query.

The canonical system-level architecture is documented in:

```text
docs/LEMAP_ARCHITECTURE.md
```

Supporting design history and deeper notes remain in:

```text
docs/SEMANTIC_EXPLORATION_ARCHITECTURE.md
demo_v2/ARCHITECTURE.md
demo_v2/PASS1_BUSINESS_ARC_DISCOVERY.md
```

---

## Current architecture at a glance

```text
Repository / framework evidence
        ↓
Deterministic topology + adapters
        ↓
Call-path preprocessing + Scout
        ↓
Pass 1 scheduler
        ↓
Pass 2 workflow reconstruction
        ↓
Entity/schema reconciliation
        ↓
Persistent LeMap
        ↓
Query-v4
```

The current working query path is:

```text
demo_v2/server/query_v4/*
```

The current working learning/persistence path is centered under:

```text
demo_v2/server/explorer/*
```

---

## Core principle

LeMap separates deterministic structure from semantic interpretation.

```text
structure can prove it → code owns it
meaning must be inferred → model interprets it
```

Examples:

- call edges, FKs, path containment, evidenced joins → deterministic
- business intent, workflow identity, semantic boundary, field meaning → model-assisted semantics

The model should not spend tokens rediscovering relationships already proven by the graph.

---

## Learning path

Learning currently combines two routes before Pass 1.

### Scout / semantic discovery

Scout looks for materially different business-use-case directions that may still be missing.

### Deterministic call-path discovery

The repository is converted into executable topology, branch/cycle-safe paths are constructed and grouped, and the model is used only to classify business meaning and identify semantic boundaries.

After clipping at the semantic boundary, structural containment is calculated mechanically and maximal coherent flows seed Pass 1.

### Pass 1

Pass 1 schedules qualified business arcs and decides which workflow receives the next exploration turn.

### Pass 2

Pass 2 reconstructs one selected workflow in depth, following high business-continuity evidence and backing away when the semantic signal dampens.

Reusable business subflows remain separate semantic workflows rather than being recursively duplicated into every parent flow.

---

## Entity and persistence path

Workflows are connected to persistent entities and schema relationships.

The current implementation includes:

- entity reconciliation
- schema catalog materialization
- schema relationship materialization
- map persistence/loading
- resume learning over an existing map
- compact-map persistence/logging

LeMap is therefore an accumulating evidence-backed semantic graph, not a one-run report.

New evidence should refine or extend the persistent map rather than require complete rediscovery.

---

## Query-v4

`query_v4` is the current query implementation.

Its main flow is:

```text
natural-language question
        ↓
derive ordered analytical plan / dimensions
        ↓
seed from learned workflows when available
        ↓
expand workflow → entity
        ↓
inspect complete entity schema
        ↓
follow real schema FK edges when useful
        ↓
track unresolved requirements
        ↓
connect accepted evidence deterministically
        ↓
verify the ordered answer plan
        ↓
grounded answer
```

Important query-v4 modules:

```text
queryEngine.js
stateExpander.js
scorer.js
coverage.js
connectivity.js
verifier.js
queryApi.js
```

Workflow roots are preferred when learned workflows are available. Directory/hierarchy roots are a fallback.

Coverage is coverage of the query's required semantic dimensions, not percentage of the whole graph visited.

Connectivity is determined from evidenced schema joins. Multi-hop connections are valid when LeMap can prove them structurally.

Verification checks that the selected evidence actually implements the ordered answer plan and preserves the requested semantic grain. A failed later requirement can be reopened without discarding already-valid earlier evidence.

Current query-v4 does not write newly discovered query-time facts back into the persistent semantic map; that is a future reconciliation extension documented in `docs/LEMAP_ARCHITECTURE.md`.

---

## Framework adapters

Generic parsing should capture generic program/data relationships.

Framework-specific execution/schema semantics belong behind adapters.

Current examples include Moqui XML execution and Moqui entity-schema handling.

This boundary is intended to allow future frameworks and evidence sources to plug into the same LeMap semantic model.

---

## Run

```powershell
cd demo_v2
npm install
$env:DEEPSEEK_API_KEY="..."
$env:DEEPSEEK_MODEL="deepseek-v4-flash"   # optional
npm start
```

Open:

```text
http://localhost:3102
```

---

## Logging and persistence

Detailed learning/query traces and persisted map state are intentionally separate from terse live console output.

The persistent map is the reusable product of learning; query sessions operate over that map and maintain their own traversal/coverage state.

---

## Important demo rules

- Source files are evidence/provenance; semantic workflows and entities are the primary map objects.
- Mechanical topology is deterministic and should not be repeatedly inferred by the model.
- Business continuity drives exploration depth; technical adjacency alone is not enough.
- Shared persistent business entities are stronger semantic evidence than reuse of generic helper functions.
- Material branches remain part of a workflow until closed or bounded.
- Reusable business processes become separately referenced workflows.
- External implementations outside the evidence boundary are black boxes.
- Progress is semantic workflow closure, not source-code coverage.
- Query stops based on resolution/exhaustion of its relevant evidence frontier, not traversal of the entire graph.
