# Odoo runtime harness

This folder is intentionally separate from static Odoo source analysis.

Responsibilities:

- load enterprise-owned business scenarios
- resolve user-visible UI actions through Odoo view metadata
- execute scenarios through an injected disposable/staging Odoo executor
- collect enterprise-scoped structured runtime traces

The scenario file describes user behavior, not framework internals. A scenario says "click Confirm", not "call sale.order.action_confirm".

The first runtime-probe implementation lives under `odoo_probe/`. It is designed for bounded disposable/staging runs and writes JSONL events when `LEMAP_RUNTIME_TRACE_FILE` is set.

The JavaScript runner is executor-neutral so Docker, XML-RPC/JSON-RPC, test harnesses or future SaaS workers can implement the same interface.
