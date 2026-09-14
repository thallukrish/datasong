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

## Current implementation

The first slice detects Odoo addons, reads literal `__manifest__.py` metadata, extracts model definitions and `_inherit` extensions, normalizes ORM fields and relationships, and assigns stable Odoo model identities with source provenance.

The next slice now adds targeted Odoo 19 framework-schema learning:

```text
ACME project source
    ↓
project schemas and addon dependencies
    ↓
referenced standard Odoo model seeds
    ↓
installed Odoo module dependency closure
    ↓
targeted lookup in official Odoo 19 source
    ↓
reusable Odoo 19 framework map
    ↓
framework schemas + ACME extensions
    ↓
effective entity-schema catalog
```

Only project-relevant Odoo modules are eligible for model resolution. Model lookup uses targeted source search and parses only matching Python files rather than semantically crawling the entire Odoo repository.

The reusable framework map is stored at:

```text
demo_v2/data/semantic-maps/frameworks/odoo/19/map.json
```

The default Odoo 19 source checkout is cached at:

```text
demo_v2/data/repo-cache/frameworks/odoo/19/source
```

If an Odoo 19 checkout already exists locally, set `ODOO_SOURCE_DIR` to that directory before running LeMap. Framework schemas are reused only when their source commit matches the active Odoo checkout.

The existing Moqui path remains unchanged for non-Odoo repositories. Odoo detection and augmentation run through the isolated Odoo runtime helper. A shared cross-framework adapter/layered-map contract is intentionally deferred until the ACME EMS path is proven, at which point the common behavior from both implementations can be extracted based on evidence rather than assumed up front.

This slice enriches the deterministic entity/field/relationship layer. It does **not** yet inject official Odoo source call paths or workflow execution into Pass 1 / Pass 2; that is the next step after framework-schema composition is verified on ACME EMS.

## ACME EMS profile

Configuration is stored at:

```text
lemap-odoo/config/acme-ems.json
```

For verification, run `npm test` from `demo_v2`, then prepare `https://github.com/thallukrish/acme-ems-odoo` with `ProgressiveRepositoryTopologyV9`.

The smoke result should identify Odoo 19, resolve the custom `acme.manufacturer.part` project model, resolve standard models such as `mrp.production` / `mrp.bom` from official Odoo source, and expose `mrp.production` as a composed schema containing both standard fields and ACME `ems_*` extension fields.
