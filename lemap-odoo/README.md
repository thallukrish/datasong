# LeMap Odoo

`lemap-odoo` is the runnable Odoo profile for the shared LeMap engine.

It is not a fork of LeMap. The current LeMap learning, persistence, exploration, and query implementation remains under `demo_v2`; Odoo support is added through framework-specific adapters and layered semantic-map persistence.

The first end-to-end target is the fictional Odoo 19 EMS project in `thallukrish/acme-ems-odoo`.

## Architecture

See:

```text
lemap-odoo/docs/LEMAP_ODOO_ARCHITECTURE.md
```

The key design is:

```text
Odoo 19 framework map
        +
ACME EMS project map
        =
ACME EMS effective map
```

Learning is intended to be automatic and seamless: when a project references or extends standard Odoo objects, LeMap reuses already-known Odoo semantics and learns only the missing relevant framework neighborhood, persisting framework knowledge separately from project-specific knowledge.

## V1 status

V1 validates deterministic Odoo extraction first. The shared `demo_v2` learner remains the runtime.

This first slice detects Odoo addons, reads literal `__manifest__.py` metadata, extracts model definitions and `_inherit` extensions, normalizes ORM fields and relationships, and assigns stable Odoo model identities with source provenance.

Layered framework/project persistence and selective Odoo-core source enrichment are the next implementation slice after this parser/profile milestone is verified on ACME EMS.

The Moqui adapter remains isolated and is selected only for Moqui repositories; the Odoo adapter is selected independently from Odoo manifest evidence. Common adapter abstractions should be extracted only after the ACME EMS path is proven.

## ACME EMS profile

Configuration is stored at:

```text
lemap-odoo/config/acme-ems.json
```

For verification, run `npm test` from `demo_v2`, then prepare `https://github.com/thallukrish/acme-ems-odoo` with `ProgressiveRepositoryTopologyV9`.

The V1 smoke result should identify the framework as `odoo`, detect Odoo `19`, resolve the custom `acme.manufacturer.part` model, and resolve the ACME extension of `mrp.production`.
