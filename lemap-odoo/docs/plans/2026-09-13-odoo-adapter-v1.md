# Odoo Adapter V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first deterministic Odoo adapter slice so LeMap can learn ACME EMS module manifests, models, `_inherit` extensions, ORM fields/relationships, and framework-vs-project ownership without changing higher-level Pass 1/Pass 2/query semantics.

**Architecture:** Keep `demo_v2` as the shared LeMap engine. Add an Odoo adapter bundle parallel to the Moqui bundle, then make topology choose the framework adapter based on repository evidence. V1 produces normalized entity/schema objects with provenance and stable Odoo IDs; layered persistence is introduced only far enough to distinguish reusable Odoo framework knowledge from ACME project knowledge.

**Tech Stack:** Node.js ESM, built-in `node:test`, `simple-git`, existing `demo_v2` topology/entity-schema interfaces.

**Spec:** `lemap-odoo/docs/LEMAP_ODOO_ARCHITECTURE.md`

## Global Constraints

- `demo_v2` remains the common LeMap engine; `lemap-odoo` is a runner/profile, not a fork.
- Learning starts from the customer/project repository and follows only relevant Odoo framework areas.
- Standard Odoo knowledge and project-specific knowledge are persisted separately by provenance.
- Standard framework objects use stable version-aware identities such as `odoo19:model:mrp.production`.
- No ACME business answers may be hard-coded.
- Existing Moqui behavior must remain unchanged.

---

## File structure for this slice

```text
demo_v2/server/adapters/odoo/
  index.js                 adapter bundle factory
  detect.js                Odoo repo/module detection + manifest parsing
  modelParser.js           Python model/_name/_inherit/field extraction
  schemaAdapter.js         normalized schema/provenance/stable IDs
  detect.test.js
  modelParser.test.js
  schemaAdapter.test.js

demo_v2/server/adapters/
  frameworkResolver.js     choose Moqui/Odoo adapter bundle

demo_v2/server/
  progressiveRepositoryTopologyV9.js

lemap-odoo/
  README.md
  config/acme-ems.json
```

`frameworkResolver.js` is deliberately tiny: it prevents topology from accumulating framework-specific branching as more adapters arrive.

---

### Task 1: Detect Odoo repositories and parse addon manifests

**Files:**
- Create: `demo_v2/server/adapters/odoo/detect.js`
- Create: `demo_v2/server/adapters/odoo/detect.test.js`

**Interfaces:**
- Produces: `detectOdooRepository({ repoDir, trackedFiles }) -> { detected, version, addons }`
- Each addon: `{ name, manifestPath, depends, data, application, installable }`

- [ ] **Step 1: Write the failing manifest/detection tests**

Use temporary fixtures instead of depending on the live ACME repo during unit tests.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { detectOdooRepository } from './detect.js';

test('detects Odoo addons and manifest dependencies', async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-'));
  const manifestPath = 'addons/acme_ems_manufacturing/__manifest__.py';
  await fs.mkdir(path.join(repoDir, 'addons/acme_ems_manufacturing'), { recursive: true });
  await fs.writeFile(path.join(repoDir, manifestPath), `{
    'name': 'ACME EMS Manufacturing',
    'version': '19.0.1.0.0',
    'depends': ['mrp', 'stock'],
    'data': ['views/manufacturing_views.xml'],
    'installable': True,
    'application': False,
  }`);

  const result = await detectOdooRepository({ repoDir, trackedFiles: [manifestPath] });
  assert.equal(result.detected, true);
  assert.equal(result.version, '19');
  assert.deepEqual(result.addons[0].depends, ['mrp', 'stock']);
  assert.deepEqual(result.addons[0].data, ['views/manufacturing_views.xml']);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
cd demo_v2
node --test server/adapters/odoo/detect.test.js
```

Expected: FAIL because `detect.js` does not exist.

- [ ] **Step 3: Implement minimal safe manifest parsing**

Implement a small parser for Odoo's literal manifest syntax; do not execute arbitrary Python.

```js
import fs from 'node:fs/promises';
import path from 'node:path';

const pickList = (text, key) => {
  const m = text.match(new RegExp(`["']${key}["']\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map(x => x[1]) : [];
};
const pickBool = (text, key, fallback) => {
  const m = text.match(new RegExp(`["']${key}["']\\s*:\\s*(True|False)`));
  return m ? m[1] === 'True' : fallback;
};
const pickString = (text, key) => {
  const m = text.match(new RegExp(`["']${key}["']\\s*:\\s*["']([^"']+)["']`));
  return m ? m[1] : '';
};

export async function detectOdooRepository({ repoDir, trackedFiles = [] }) {
  const manifests = trackedFiles.filter(f => /(?:^|\/)__manifest__\.py$/.test(f));
  const addons = [];
  let version = '';
  for (const manifestPath of manifests) {
    const text = await fs.readFile(path.join(repoDir, manifestPath), 'utf8');
    const addonName = manifestPath.split('/').slice(-2, -1)[0];
    const manifestVersion = pickString(text, 'version');
    if (!version && /^\d+\./.test(manifestVersion)) version = manifestVersion.split('.')[0];
    addons.push({
      name: addonName,
      manifestPath,
      depends: pickList(text, 'depends'),
      data: pickList(text, 'data'),
      application: pickBool(text, 'application', false),
      installable: pickBool(text, 'installable', true)
    });
  }
  return { detected: addons.length > 0, version, addons };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test server/adapters/odoo/detect.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_v2/server/adapters/odoo/detect.js demo_v2/server/adapters/odoo/detect.test.js
git commit -m "feat: detect Odoo addons and manifests"
```

---

### Task 2: Parse Odoo models, extensions, fields, and ORM relationships

**Files:**
- Create: `demo_v2/server/adapters/odoo/modelParser.js`
- Create: `demo_v2/server/adapters/odoo/modelParser.test.js`

**Interfaces:**
- Produces: `extractOdooModels(sourcePath, source, addonName) -> OdooModel[]`
- `OdooModel` fields: `{ className, name, inherits, extension, sourcePath, addon, fields }`
- Field shape: `{ name, type, relatedModel, relation, required, readonly, string, sourceLine }`

- [ ] **Step 1: Write failing parser tests covering `_name`, `_inherit`, and relation fields**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractOdooModels } from './modelParser.js';

test('extracts a new Odoo model and relational fields', () => {
  const src = `
class BomRevision(models.Model):
    _name = "acme.bom.revision"
    _description = "EMS BOM Revision"
    bom_id = fields.Many2one("mrp.bom", required=True)
    approved_supplier_ids = fields.Many2many("res.partner")
`;
  const [model] = extractOdooModels('addons/acme/models/bom_revision.py', src, 'acme');
  assert.equal(model.name, 'acme.bom.revision');
  assert.equal(model.extension, false);
  assert.equal(model.fields[0].relatedModel, 'mrp.bom');
  assert.equal(model.fields[0].relation, 'many-to-one');
});

test('extracts an extension of a standard Odoo model', () => {
  const src = `
class MrpProduction(models.Model):
    _inherit = "mrp.production"
    ems_shortage_qty = fields.Float()
    ems_blocking_component_id = fields.Many2one("product.product")
`;
  const [model] = extractOdooModels('addons/acme/models/mrp_production.py', src, 'acme');
  assert.equal(model.name, 'mrp.production');
  assert.deepEqual(model.inherits, ['mrp.production']);
  assert.equal(model.extension, true);
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
node --test server/adapters/odoo/modelParser.test.js
```

Expected: FAIL because parser does not exist.

- [ ] **Step 3: Implement minimal deterministic Python-pattern parser**

Use class-block detection plus literal `_name`, `_inherit`, and `fields.*` assignment parsing. V1 intentionally supports literal model declarations, which covers normal Odoo addon style and ACME EMS.

Core relationship normalization:

```js
const RELATION_BY_TYPE = {
  Many2one: 'many-to-one',
  One2many: 'one-to-many',
  Many2many: 'many-to-many'
};
```

For `_inherit = ['a', 'b']`, capture both values. When `_name` is absent and one inherited model exists, use that inherited model as `name` and set `extension: true`.

- [ ] **Step 4: Add test for multiple inheritance and scalar fields**

```js
test('captures multiple inherited models and scalar fields', () => {
  const src = `
class X(models.Model):
    _name = 'acme.x'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    code = fields.Char(required=True)
`;
  const [model] = extractOdooModels('x.py', src, 'acme');
  assert.deepEqual(model.inherits, ['mail.thread', 'mail.activity.mixin']);
  assert.equal(model.fields[0].type, 'Char');
  assert.equal(model.fields[0].required, true);
});
```

- [ ] **Step 5: Run parser tests**

```bash
node --test server/adapters/odoo/modelParser.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_v2/server/adapters/odoo/modelParser.js demo_v2/server/adapters/odoo/modelParser.test.js
git commit -m "feat: parse Odoo models and ORM fields"
```

---

### Task 3: Normalize Odoo schemas with stable IDs and provenance

**Files:**
- Create: `demo_v2/server/adapters/odoo/schemaAdapter.js`
- Create: `demo_v2/server/adapters/odoo/schemaAdapter.test.js`
- Create: `demo_v2/server/adapters/odoo/index.js`

**Interfaces:**
- Produces: `new OdooEntitySchemaAdapter(topology).augment()`
- Populates the existing `topology.entitySchemas` and `topology.entitySchemaByName` interfaces.
- Adds normalized metadata: `stableId`, `framework`, `frameworkVersion`, `ownership`, `provenance`, `extensionOf`.

- [ ] **Step 1: Write failing schema-adapter test with a fake topology**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OdooEntitySchemaAdapter } from './schemaAdapter.js';

test('materializes project Odoo schema with stable framework reference', async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lemap-odoo-schema-'));
  const sourcePath = 'addons/acme_ems_manufacturing/models/mrp_production.py';
  await fs.mkdir(path.dirname(path.join(repoDir, sourcePath)), { recursive: true });
  await fs.writeFile(path.join(repoDir, sourcePath), `
class MrpProduction(models.Model):
    _inherit = 'mrp.production'
    ems_shortage_qty = fields.Float()
`);
  const topology = {
    repoDir,
    trackedFiles: [sourcePath],
    odooDetection: { version: '19', addons: [{ name: 'acme_ems_manufacturing' }] },
    entitySchemas: [],
    entitySchemaByName: new Map()
  };
  const result = await new OdooEntitySchemaAdapter(topology).augment();
  const schema = topology.entitySchemaByName.get('mrp.production');
  assert.equal(result.adapter, 'odoo-entity-schema-v1');
  assert.equal(schema.stableId, 'odoo19:model:mrp.production');
  assert.equal(schema.ownership, 'project-extension');
  assert.equal(schema.extensionOf, 'odoo19:model:mrp.production');
});
```

- [ ] **Step 2: Run and verify failure**

```bash
node --test server/adapters/odoo/schemaAdapter.test.js
```

- [ ] **Step 3: Implement schema normalization**

Normalize parser output to the shape already expected by LeMap entity/schema consumers:

```js
{
  name: model.name,
  fullName: model.name,
  fields: model.fields,
  relationships: model.fields
    .filter(f => f.relatedModel)
    .map(f => ({
      type: f.relation,
      relatedEntityName: f.relatedModel,
      title: f.name,
      keyMaps: []
    })),
  stableId: `odoo${version}:model:${model.name}`,
  framework: 'odoo',
  frameworkVersion: version,
  ownership: model.extension ? 'project-extension' : 'project',
  extensionOf: model.extension ? `odoo${version}:model:${model.name}` : '',
  provenance: { sourcePath: model.sourcePath, addon: model.addon, layer: 'project' }
}
```

Do not persist framework source yet; this task establishes the ownership and identity contract that framework resolution will use.

- [ ] **Step 4: Add bundle factory**

`demo_v2/server/adapters/odoo/index.js`:

```js
import { OdooEntitySchemaAdapter } from './schemaAdapter.js';

export function createOdooAdapters(topology) {
  return {
    entitySchema: new OdooEntitySchemaAdapter(topology),
    execution: null
  };
}

export { OdooEntitySchemaAdapter };
```

- [ ] **Step 5: Run Odoo adapter tests**

```bash
node --test server/adapters/odoo/*.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_v2/server/adapters/odoo
git commit -m "feat: normalize Odoo schemas with stable identities"
```

---

### Task 4: Select framework adapters without breaking Moqui

**Files:**
- Create: `demo_v2/server/adapters/frameworkResolver.js`
- Create: `demo_v2/server/adapters/frameworkResolver.test.js`
- Modify: `demo_v2/server/progressiveRepositoryTopologyV9.js`

**Interfaces:**
- Produces: `resolveFrameworkAdapters(topology) -> { kind, detection, adapters }`
- `kind` is `'odoo' | 'moqui' | 'generic'`.

- [ ] **Step 1: Write failing resolver tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrameworkAdapters } from './frameworkResolver.js';

test('chooses Odoo for repositories with manifests', async () => {
  const topology = {
    repoDir: '/tmp/fake',
    trackedFiles: ['addons/acme/__manifest__.py']
  };
  const resolved = await resolveFrameworkAdapters(topology, {
    detectOdoo: async () => ({ detected: true, version: '19', addons: [] })
  });
  assert.equal(resolved.kind, 'odoo');
});

test('keeps Moqui selection for component.xml repositories', async () => {
  const topology = { repoDir: '/tmp/fake', trackedFiles: ['component.xml'] };
  const resolved = await resolveFrameworkAdapters(topology, {
    detectOdoo: async () => ({ detected: false, version: '', addons: [] })
  });
  assert.equal(resolved.kind, 'moqui');
});
```

- [ ] **Step 2: Implement resolver**

Resolution order:

```text
Odoo manifest evidence → Odoo
component.xml / Moqui evidence → Moqui
otherwise → generic/no framework adapter
```

Return adapter bundles, not framework-specific fields, so `ProgressiveRepositoryTopologyV9` only orchestrates normalized interfaces.

- [ ] **Step 3: Modify topology preparation**

Replace the constructor's unconditional `createMoquiAdapters(this)` with framework resolution after `super.prepare(repoUrl)` has populated `repoDir` and `trackedFiles`.

Target shape:

```js
async prepare(repoUrl) {
  const prep = await super.prepare(repoUrl);
  const resolved = await resolveFrameworkAdapters(this);
  this.frameworkKind = resolved.kind;
  this.frameworkDetection = resolved.detection;
  this.frameworkAdapters = resolved.adapters;

  if (resolved.kind === 'odoo') this.odooDetection = resolved.detection;

  this.frameworkEntitySchema = this.frameworkAdapters?.entitySchema
    ? await this.frameworkAdapters.entitySchema.augment()
    : null;
  this.frameworkExecution = this.frameworkAdapters?.execution
    ? await this.frameworkAdapters.execution.augment()
    : null;

  this.callPathIndex = this.callPathIndexer.build();
  return { ...prep, frameworkKind: this.frameworkKind, frameworkEntitySchema: this.frameworkEntitySchema, frameworkExecution: this.frameworkExecution, callPathIndex: { /* existing fields */ } };
}
```

Preserve the old `moquiEntitySchema`/`moquiXmlExecution` aliases only if existing consumers still read them; if retained, populate them only when `frameworkKind === 'moqui'`.

- [ ] **Step 4: Run the full existing test suite**

```bash
npm test
```

Expected: all pre-existing tests pass plus new Odoo tests.

- [ ] **Step 5: Smoke-test ACME EMS preparation**

From `demo_v2`, run a small one-shot script against the public ACME repo:

```bash
node --input-type=module - <<'NODE'
import { ProgressiveRepositoryTopologyV9 } from './server/progressiveRepositoryTopologyV9.js';
const topology = new ProgressiveRepositoryTopologyV9({ cacheRoot: './data/repo-cache' });
const result = await topology.prepare('https://github.com/thallukrish/acme-ems-odoo');
console.log(JSON.stringify({
  frameworkKind: result.frameworkKind,
  version: topology.odooDetection?.version,
  entities: topology.entitySchemas.length,
  mrpProduction: topology.entitySchema('mrp.production')
}, null, 2));
NODE
```

Expected:

```text
frameworkKind = odoo
version = 19
mrp.production is resolved
ems_shortage_qty is present on the project extension schema
```

- [ ] **Step 6: Commit**

```bash
git add demo_v2/server/adapters/frameworkResolver.js demo_v2/server/adapters/frameworkResolver.test.js demo_v2/server/progressiveRepositoryTopologyV9.js
git commit -m "feat: select Odoo and Moqui framework adapters"
```

---

### Task 5: Add the `lemap-odoo` ACME runner profile

**Files:**
- Create: `lemap-odoo/config/acme-ems.json`
- Modify: `lemap-odoo/README.md`

**Interfaces:**
- Config provides: `{ projectId, repoUrl, framework, frameworkVersion }`

- [ ] **Step 1: Add ACME profile**

```json
{
  "projectId": "acme-ems",
  "repoUrl": "https://github.com/thallukrish/acme-ems-odoo",
  "framework": "odoo",
  "frameworkVersion": "19"
}
```

- [ ] **Step 2: Document the V1 run path**

Add to `lemap-odoo/README.md`:

```text
V1 validates deterministic Odoo extraction first. The shared demo_v2 learner remains the runtime. Layered framework/project persistence and selective Odoo-core source enrichment are the next implementation slice after this parser/profile milestone is verified on ACME EMS.
```

Also document the smoke command from Task 4.

- [ ] **Step 3: Run final verification**

```bash
cd demo_v2
npm test
```

Then run the ACME smoke command again and inspect that custom models such as `acme.manufacturer.part` and extensions such as `mrp.production` appear.

- [ ] **Step 4: Commit**

```bash
git add lemap-odoo/config/acme-ems.json lemap-odoo/README.md
git commit -m "docs: add ACME EMS Odoo runner profile"
```

---

## Follow-on slice after V1

Do not fold these into this implementation unless V1 is complete and reviewed:

```text
ACME extension reference
  → clone/read matching Odoo 19 source
  → learn only relevant framework model/workflow neighborhood
  → persist framework-owned nodes separately
  → persist ACME-owned nodes separately
  → compose effective map
```

That follow-on needs its own plan because it changes persistence/reconciliation semantics, whereas V1 is independently testable as deterministic Odoo source understanding.
