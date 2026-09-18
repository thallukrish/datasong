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


## Current V1 execution path

1. Add `runtime/odoo_probe` to the Odoo addons path.
2. Load `lemap_runtime_probe` as a server-wide module for the disposable/staging run.
3. Set:

```text
LEMAP_RUNTIME_TRACE=1
LEMAP_RUNTIME_TRACE_FILE=/logs/odoo-runtime.jsonl
LEMAP_ENTERPRISE_ID=acme-ems
LEMAP_SCENARIO_ID=sale-to-manufacturing
LEMAP_SESSION_ID=<unique-run-id>
```

4. Start Odoo.
5. Run the enterprise scenario:

```powershell
node scripts/odoo-runtime-scenarios.js ..\acme-ems-odoo\lemap\odoo-scenarios.json
```

The runner uses `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` and `ODOO_VIEW_ROOTS`.

`ODOO_VIEW_ROOTS` is a platform path-delimited list of roots containing project/framework XML views. The runner resolves clicks by model + visible button label from those XML files, then executes the resolved object method through Odoo RPC.

After a trace is collected, point static learning at it:

```powershell
$env:ODOO_RUNTIME_TRACE_PATH="C:\path\to\odoo-runtime.jsonl"
node scripts/acme-pass1-handoff-assessment.js
```

`ProgressiveRepositoryTopologyV9` correlates the trace onto static Odoo symbols/edges before CallPathIndexer runs. Equal first-class-count paths then prefer stronger runtime-observed edge/symbol evidence.
