# Odoo Evidence-Driven Adapter Implementation Plan

**Goal:** Make the existing Odoo adapter assess static UI/framework evidence, expose concrete Odoo entrypoints, and explicitly report when runtime evidence is required before enterprise-specific call paths are passed to the generic CallPathIndexer.

**Architecture:** Preserve the existing Odoo execution/schema code. Add a small evidence-assessment layer that parses Odoo XML/manifests, classifies entrypoints and unresolved runtime boundaries, and then wrap the existing Odoo pieces behind one facade. No Pass 1/Pass 2 changes.

**Tech Stack:** Node.js ES modules, `node:test`, existing `demo_v2/server/adapters/odoo/*` code.

**Spec:** `docs/specs/2026-09-15-odoo-evidence-driven-adapter.md`

## Global constraints

- No production DB access.
- No eager traversal of the whole Odoo framework.
- No fabricated enterprise branch selection.
- Existing CallPathIndexer remains generic and Odoo-unaware.
- Existing semantic-map persistence remains unchanged.
- Runtime instrumentation/synthetic Odoo runner is a later slice.

---

### Task 1: Parse static Odoo UI/action entrypoints

**Files:**
- Create: `demo_v2/server/adapters/odoo/uiEntrypoints.js`
- Create: `demo_v2/server/adapters/odoo/uiEntrypoints.test.js`

**Produces:**

```js
extractOdooUiEntrypoints(sourcePath, xml) -> {
  entrypoints: Array<{
    kind: 'object_button' | 'server_action',
    modelName: string,
    methodName: string,
    sourcePath: string,
    line: number
  }>,
  modelActions: Array<{ modelName, actionType, sourcePath, line }>
}
```

Test cases:
- `<button type="object" name="action_confirm">` inside a view whose model is `sale.order` emits `sale.order.action_confirm`.
- `ir.actions.act_window` emits UI/model exposure but not a method call.
- menu-only XML emits no executable entrypoint.
- obvious `ir.actions.server` code such as `records.button_confirm()` emits a server-action entrypoint when the target model is known.

### Task 2: Assess whether static evidence is sufficient

**Files:**
- Create: `demo_v2/server/adapters/odoo/evidenceAssessment.js`
- Create: `demo_v2/server/adapters/odoo/evidenceAssessment.test.js`

**Produces:**

```js
assessOdooEvidence({
  uiEntrypoints,
  projectMethodCount,
  frameworkMethodCount,
  unresolvedCalls,
  ambiguousBoundaries
}) -> {
  evidenceLevel: 'static' | 'observed',
  runtimeEvidenceRequired: boolean,
  runtimeEvidenceReasons: string[],
  entrypoints: [...],
  ambiguousBoundaries: [...]
}
```

Rules:
- Static object/server-action entrypoints are valid candidate entrances.
- Unresolved framework calls or explicitly ambiguous data/config-selected boundaries require runtime evidence.
- A field-only addon with no executable entrance reports that workflow evidence is incomplete rather than fabricating one.

### Task 3: Add a single Odoo adapter facade

**Files:**
- Create: `demo_v2/server/adapters/odoo/adapter.js`
- Create: `demo_v2/server/adapters/odoo/adapter.test.js`
- Modify: `demo_v2/server/adapters/odoo/index.js`

**Produces:**

```js
class OdooAdapter {
  constructor(topology, options = {})
  async assess()
  async augment()
}
```

`augment()` delegates to existing schema/framework/execution pieces and returns one Odoo report containing execution counts, static UI entrypoints, unresolved boundaries and runtime-evidence status. It must not move ambiguity handling into CallPathIndexer.

### Task 4: Feed static UI entrypoints into targeted framework expansion

**Files:**
- Modify: `demo_v2/server/adapters/odoo/executionAdapter.js`
- Modify: `demo_v2/server/adapters/odoo/executionAdapter.test.js`

Behavior:
- Accepted UI entrypoints become targeted framework seeds, e.g. `sale.order.action_confirm`.
- Expansion remains bounded by existing depth/method caps and allowed modules.
- `ir.actions.act_window`/menu exposure does not become a call edge.
- Unresolvable or branch-ambiguous continuations are reported rather than guessed.

### Task 5: ACME acceptance assessment

**Files:**
- Create: `demo_v2/server/adapters/odoo/acmeAssessment.test.js`

Fixture/acceptance assertions:
- ACME manifests identify Odoo module scope.
- ACME custom manufacturing XML exposes `acme.bom.revision` views/actions but no business-method button entrypoint.
- Existing `post_init_hook` is recognized separately as setup/demo execution evidence.
- The adapter can report runtime evidence required for enterprise workflow selection when static evidence does not uniquely establish the relevant Odoo branch.

### Task 6: Verification

Run from `demo_v2`:

```bash
node --test server/adapters/odoo/uiEntrypoints.test.js
node --test server/adapters/odoo/evidenceAssessment.test.js
node --test server/adapters/odoo/adapter.test.js
node --test server/adapters/odoo/executionAdapter.test.js
node --test server/adapters/odoo/acmeAssessment.test.js
npm test
```

No implementation should be called complete until these commands are run successfully in an environment with the repository available locally.
