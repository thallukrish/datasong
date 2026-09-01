# DataSong / LeMap

LeMap builds a persistent, evidence-backed semantic map of enterprise workflows, entities, relationships and the source evidence that supports them.

The current reference implementation is `demo_v2`.

Current architecture documentation:

- [`docs/LEMAP_ARCHITECTURE.md`](docs/LEMAP_ARCHITECTURE.md) — canonical whole-system architecture
- [`demo_v2/ARCHITECTURE.md`](demo_v2/ARCHITECTURE.md) — concrete Scout / call-path / Pass-1 / Pass-2 learning architecture
- [`docs/SEMANTIC_EXPLORATION_ARCHITECTURE.md`](docs/SEMANTIC_EXPLORATION_ARCHITECTURE.md) — foundational source-agnostic evidence/exploration model
- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — broader product intent

Current working paths:

```text
Learning / persistence: demo_v2/server/explorer/*
Query:                demo_v2/server/query_v4/*
```

The core architectural rule is:

> Use deterministic structure wherever the evidence can prove a relationship; use the model for semantic interpretation where structure alone cannot determine meaning.
