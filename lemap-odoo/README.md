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

Learning is automatic and seamless: when a project references or extends standard Odoo objects, LeMap reuses already-known Odoo semantics and learns only the missing relevant framework neighborhood, persisting framework knowledge separately from project-specific knowledge.
