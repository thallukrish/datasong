# Odoo Framework Map V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Starting from ACME EMS project schemas, resolve only the referenced Odoo 19 model neighborhood from official Odoo source, persist those standard schemas in a reusable Odoo 19 framework map, and compose them with ACME project schemas for the existing LeMap entity-schema consumers.

**Architecture:** Keep the existing Moqui path untouched and keep all new framework-learning behavior behind `server/adapters/odoo/`. The Odoo adapter derives framework seeds from deterministic project evidence, resolves matching standard models from an Odoo 19 source checkout using targeted `git grep`, persists only resolved standard models into a versioned framework map, and composes framework + project schemas into `topology.entitySchemas`. This slice does not inject Odoo source call paths into Pass 1/Pass 2 yet; it establishes the reusable base entity/relationship layer first.

**Tech Stack:** Node.js ESM, built-in `node:test`, `simple-git`, existing `demo_v2` topology/entity-schema interfaces.

**Spec:** `lemap-odoo/docs/LEMAP_ODOO_ARCHITECTURE.md`

## Global Constraints

- `demo_v2` remains the common LeMap engine; `lemap-odoo` is a runner/profile, not a fork.
- Existing Moqui behavior must remain unchanged.
- Learning starts from project evidence and follows only relevant Odoo framework models.
- Do not crawl or semantically parse the entire Odoo repository.
- Official Odoo source provenance owns framework knowledge; ACME source provenance owns project knowledge.
- Framework stable IDs remain version-aware, e.g. `odoo19:model:mrp.production`.
- Framework and project persistence remain separate.
- No ACME business answers may be hard-coded.
- Common Moqui/Odoo layered-map abstractions are intentionally deferred until ACME EMS is proven.

---

## File structure for this slice

```text
demo_v2/server/adapters/odoo/
  frameworkSeeds.js          derive standard-model seeds from project schemas
  frameworkSource.js         locate/cache official Odoo source + targeted model lookup
  frameworkMapStore.js       versioned Odoo framework-map persistence
  frameworkEnricher.js       resolve standard model neighborhood and normalize framework schemas
  composeSchemas.js          compose framework + project schemas into effective schemas
  *.test.js
  index.js                   expose framework enricher alongside project schema adapter

demo_v2/server/
  progressiveRepositoryTopologyV9.js   invoke Odoo framework enrichment only on Odoo path
```

Framework map storage for this Odoo-first proof:

```text
demo_v2/data/semantic-maps/frameworks/odoo/19/map.json
```

The existing repository semantic-map file remains the project learning map. This task does not refactor generic map persistence.

---

### Task 1: Derive targeted Odoo framework seeds from project schemas

**Files:**
- Create: `demo_v2/server/adapters/odoo/frameworkSeeds.js`
- Create: `demo_v2/server/adapters/odoo/frameworkSeeds.test.js`

**Interfaces:**
- Produces: `frameworkModelSeeds(projectSchemas) -> string[]`
- A seed is a standard model name referenced by a project extension or relational project field.

- [ ] **Step 1: Write failing tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkModelSeeds } from './frameworkSeeds.js';

test('derives standard model seeds without treating project models as framework', () => {
  const schemas = [
    {
      name: 'acme.bom.revision', ownership: 'project',
      relationships: [
        { relatedEntityName: 'mrp.bom' },
        { relatedEntityName: 'acme.approved.supply' }
      ]
    },
    {
      name: 'acme.approved.supply', ownership: 'project', relationships: []
    },
    {
      name: 'mrp.production', ownership: 'project-extension',
      extensionOf: 'odoo19:model:mrp.production',
      relationships: [{ relatedEntityName: 'product.product' }]
    }
  ];
  assert.deepEqual(frameworkModelSeeds(schemas), [
    'mrp.bom', 'mrp.production', 'product.product'
  ]);
});
```

- [ ] **Step 2: Run RED**

```bash
cd demo_v2
node --test server/adapters/odoo/frameworkSeeds.test.js
```

Expected: FAIL because `frameworkSeeds.js` does not exist.

- [ ] **Step 3: Implement seed derivation**

```js
const arr = (value) => Array.isArray(value) ? value : [];

export function frameworkModelSeeds(projectSchemas = []) {
  const projectNames = new Set(arr(projectSchemas).map((schema) => String(schema?.name || '')).filter(Boolean));
  const seeds = new Set();
  for (const schema of arr(projectSchemas)) {
    if (schema?.ownership === 'project-extension' && schema?.name) seeds.add(String(schema.name));
    for (const rel of arr(schema?.relationships)) {
      const name = String(rel?.relatedEntityName || '');
      if (name && !projectNames.has(name)) seeds.add(name);
    }
  }
  return [...seeds].sort();
}
```

- [ ] **Step 4: Run GREEN**

```bash
node --test server/adapters/odoo/frameworkSeeds.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/adapters/odoo/frameworkSeeds.js server/adapters/odoo/frameworkSeeds.test.js
git commit -m "feat: derive Odoo framework model seeds"
```

---

### Task 2: Resolve official Odoo source and targeted model files

**Files:**
- Create: `demo_v2/server/adapters/odoo/frameworkSource.js`
- Create: `demo_v2/server/adapters/odoo/frameworkSource.test.js`

**Interfaces:**
- Produces: `ensureOdooSource({ version, cacheRoot, sourceDir, gitFactory }) -> { repoDir, commit, repoUrl }`
- Produces: `findOdooModelFiles({ repoDir, modelName, gitFactory }) -> string[]`
- `sourceDir` is optional and supports the `ODOO_SOURCE_DIR` override at the caller.

- [ ] **Step 1: Write failing tests using a temporary git repository**

Create a temporary repository containing:

```text
addons/mrp/models/mrp_production.py
addons/mrp/models/mrp_bom.py
addons/unrelated/models/example.py
```

with literal `_name` declarations. Assert that `findOdooModelFiles(..., 'mrp.production')` returns only the file(s) whose parsed model declaration actually defines or extends `mrp.production`.

Test `ensureOdooSource` with an explicit `sourceDir` so unit tests never clone the public Odoo repository.

- [ ] **Step 2: Run RED**

```bash
node --test server/adapters/odoo/frameworkSource.test.js
```

Expected: FAIL because `frameworkSource.js` does not exist.

- [ ] **Step 3: Implement source resolution**

Use `simple-git` already present in `demo_v2`.

```js
import fs from 'node:fs';
import path from 'node:path';
import simpleGit from 'simple-git';

export async function ensureOdooSource({ version, cacheRoot, sourceDir = '', gitFactory = simpleGit }) {
  const repoUrl = 'https://github.com/odoo/odoo.git';
  const explicit = String(sourceDir || '').trim();
  const repoDir = explicit || path.join(cacheRoot, 'frameworks', 'odoo', String(version), 'source');
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    fs.mkdirSync(path.dirname(repoDir), { recursive: true });
    await gitFactory().clone(repoUrl, repoDir, ['--branch', `${version}.0`, '--single-branch', '--depth', '1']);
  }
  const git = gitFactory(repoDir);
  const commit = String(await git.revparse(['HEAD'])).trim();
  return { repoDir, commit, repoUrl };
}
```

For targeted lookup, use `git grep` for the requested model name under `addons`, then parse only the returned Python files with the existing `extractOdooModels` parser and retain files whose parsed model has `name === modelName` or `inherits.includes(modelName)`.

Do not enumerate and parse every Odoo Python file.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/adapters/odoo/frameworkSource.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/adapters/odoo/frameworkSource.js server/adapters/odoo/frameworkSource.test.js
git commit -m "feat: resolve targeted Odoo framework source"
```

---

### Task 3: Persist a reusable versioned Odoo framework map

**Files:**
- Create: `demo_v2/server/adapters/odoo/frameworkMapStore.js`
- Create: `demo_v2/server/adapters/odoo/frameworkMapStore.test.js`

**Interfaces:**
- Produces: `new OdooFrameworkMapStore({ dataRoot, version })`
- Methods: `load()`, `save(map)`, `mergeSchemas({ source, schemas })`
- Persisted shape:

```js
{
  version: 1,
  framework: 'odoo',
  frameworkVersion: '19',
  updatedAt: 'ISO timestamp',
  sources: [{ repoUrl, commit }],
  schemas: { 'odoo19:model:mrp.production': { ... } }
}
```

- [ ] **Step 1: Write failing round-trip and merge tests**

Use a temporary `dataRoot`. Assert:

1. `load()` returns an empty initialized map when no file exists.
2. `mergeSchemas()` writes `semantic-maps/frameworks/odoo/19/map.json`.
3. Re-merging the same stable ID replaces that schema rather than duplicating it.
4. Source `{repoUrl, commit}` entries are deduplicated.

- [ ] **Step 2: Run RED**

```bash
node --test server/adapters/odoo/frameworkMapStore.test.js
```

Expected: FAIL because `frameworkMapStore.js` does not exist.

- [ ] **Step 3: Implement atomic JSON persistence**

Use a temporary file + rename, mirroring the safety pattern in `explorer/mapPersistence.js`. Framework-map ownership remains entirely inside the Odoo adapter in this slice.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/adapters/odoo/frameworkMapStore.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/adapters/odoo/frameworkMapStore.js server/adapters/odoo/frameworkMapStore.test.js
git commit -m "feat: persist Odoo framework schemas"
```

---

### Task 4: Learn a bounded Odoo model neighborhood and reuse cached framework schemas

**Files:**
- Create: `demo_v2/server/adapters/odoo/frameworkEnricher.js`
- Create: `demo_v2/server/adapters/odoo/frameworkEnricher.test.js`
- Modify: `demo_v2/server/adapters/odoo/index.js`

**Interfaces:**
- Produces: `new OdooFrameworkEnricher(topology, options).augment(projectSchemas)`
- Returns: `{ seeds, frameworkSchemas, learned, reused, source }`
- Default traversal: seed models plus one relationship hop, maximum 60 unique standard models.

- [ ] **Step 1: Write failing enrichment tests with a tiny fake Odoo source repo**

Fixture:

```python
# addons/mrp/models/mrp_production.py
class MrpProduction(models.Model):
    _name = 'mrp.production'
    bom_id = fields.Many2one('mrp.bom')
    product_id = fields.Many2one('product.product')

# addons/mrp/models/mrp_bom.py
class MrpBom(models.Model):
    _name = 'mrp.bom'
    product_tmpl_id = fields.Many2one('product.template')
```

Project schema fixture extends `mrp.production`.

Assert that the first run resolves `mrp.production`, follows one relationship hop to `mrp.bom` and `product.product` when source exists, persists framework ownership/provenance, and reports them as `learned`.

Run a second enrichment with the same store and assert already-persisted seed schemas are reported as `reused` and are not source-resolved again unless they are needed to discover a missing first-hop relationship.

- [ ] **Step 2: Run RED**

```bash
node --test server/adapters/odoo/frameworkEnricher.test.js
```

Expected: FAIL because `frameworkEnricher.js` does not exist.

- [ ] **Step 3: Implement normalization for framework schemas**

For each parsed standard model:

```js
{
  name: model.name,
  fullName: model.name,
  fields: model.fields.map((field) => ({ ...field, ownership: 'framework' })),
  relationships: model.fields.filter((field) => field.relatedModel).map((field) => ({
    type: field.relation,
    relatedEntityName: field.relatedModel,
    title: field.name,
    keyMaps: []
  })),
  stableId: `odoo${version}:model:${model.name}`,
  framework: 'odoo',
  frameworkVersion: version,
  ownership: 'framework',
  extensionOf: '',
  provenance: {
    sourcePath: model.sourcePath,
    repoUrl: source.repoUrl,
    commit: source.commit,
    layer: 'framework'
  }
}
```

Traversal algorithm:

```text
queue = project-derived seed models at depth 0
while queue not empty and unique models < 60
  if cached schema exists, reuse it
  else targeted-resolve model from official source and persist it
  if depth < 1, enqueue related standard models not owned by project
```

Do not traverse a project model name back into Odoo.

- [ ] **Step 4: Expose the enricher in `index.js`**

```js
export function createOdooAdapters(topology) {
  return {
    entitySchema: new OdooEntitySchemaAdapter(topology),
    frameworkEnricher: new OdooFrameworkEnricher(topology),
    execution: null
  };
}
```

- [ ] **Step 5: Run GREEN**

```bash
node --test server/adapters/odoo/frameworkEnricher.test.js server/adapters/odoo/frameworkMapStore.test.js server/adapters/odoo/frameworkSource.test.js server/adapters/odoo/frameworkSeeds.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/adapters/odoo/frameworkEnricher.js server/adapters/odoo/frameworkEnricher.test.js server/adapters/odoo/index.js
git commit -m "feat: learn targeted Odoo framework neighborhood"
```

---

### Task 5: Compose framework schemas with ACME project extensions

**Files:**
- Create: `demo_v2/server/adapters/odoo/composeSchemas.js`
- Create: `demo_v2/server/adapters/odoo/composeSchemas.test.js`

**Interfaces:**
- Produces: `composeOdooSchemas({ frameworkSchemas, projectSchemas }) -> effectiveSchemas`

- [ ] **Step 1: Write failing composition tests**

Given framework `mrp.production` with fields `name`, `bom_id` and project extension `mrp.production` with fields `ems_shortage_qty`, `ems_blocking_component_id`, assert one effective `mrp.production` schema contains all four fields and records both layers.

Given project-only `acme.manufacturer.part`, assert it remains present unchanged except for effective-layer metadata.

- [ ] **Step 2: Run RED**

```bash
node --test server/adapters/odoo/composeSchemas.test.js
```

Expected: FAIL because `composeSchemas.js` does not exist.

- [ ] **Step 3: Implement deterministic composition**

Rules:

```text
framework-only model -> framework schema
project-only model   -> project schema
same model name      -> framework base + project extension fields/relationships
```

For a composed model preserve `stableId` from the framework schema and add:

```js
{
  ownership: 'composed',
  layers: ['framework', 'project-extension'],
  frameworkSchema: framework.stableId,
  projectExtensionSources: [project.provenance]
}
```

Deduplicate fields by `name` and relationships by `(type, relatedEntityName, title)`; project fields win only on an exact same field name because they are the installation-specific extension evidence.

- [ ] **Step 4: Run GREEN**

```bash
node --test server/adapters/odoo/composeSchemas.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/adapters/odoo/composeSchemas.js server/adapters/odoo/composeSchemas.test.js
git commit -m "feat: compose Odoo framework and project schemas"
```

---

### Task 6: Wire Odoo framework enrichment into the isolated Odoo topology path

**Files:**
- Modify: `demo_v2/server/progressiveRepositoryTopologyV9.js`
- Create: `demo_v2/server/adapters/odoo/integration.test.js`

**Interfaces:**
- Odoo `prepare()` sequence becomes:

```text
project repo prepare
→ Odoo detection
→ project schema extraction
→ targeted framework enrichment
→ compose framework + project schemas
→ rebuild entitySchemaByName
→ existing call-path index over project source
```

- [ ] **Step 1: Write failing integration test**

Use a fake topology/runtime fixture that proves:

1. Odoo project schemas are extracted first.
2. Framework enrichment receives those project schemas.
3. `topology.entitySchemas` is replaced with composed effective schemas.
4. The non-Odoo/Moqui branch still invokes the existing Moqui adapters unchanged.

- [ ] **Step 2: Run RED**

```bash
node --test server/adapters/odoo/integration.test.js
```

Expected: FAIL because V9 does not yet run framework enrichment/composition.

- [ ] **Step 3: Wire only the Odoo branch**

After `this.odooEntitySchema = await ...augment()`:

```js
const projectSchemas = [...this.entitySchemas];
this.odooFramework = this.odooAdapters?.frameworkEnricher
  ? await this.odooAdapters.frameworkEnricher.augment(projectSchemas)
  : { frameworkSchemas: [] };
this.entitySchemas = composeOdooSchemas({
  frameworkSchemas: this.odooFramework.frameworkSchemas,
  projectSchemas
});
this.entitySchemaByName = new Map(this.entitySchemas.flatMap((schema) => [
  [schema.name, schema],
  [schema.fullName, schema]
]));
```

Return a compact `odooFramework` summary from `prepare()` containing seed/learned/reused counts and source commit, not the entire framework map.

Do not change the Moqui constructor or non-Odoo branch behavior.

- [ ] **Step 4: Run full verification**

```bash
npm test
```

Expected: all existing tests plus new framework-map tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/progressiveRepositoryTopologyV9.js server/adapters/odoo/integration.test.js
git commit -m "feat: compose targeted Odoo framework schemas"
```

---

### Task 7: Verify ACME EMS end to end and document the reusable base map

**Files:**
- Modify: `lemap-odoo/README.md`

**Interfaces:**
- Runtime override: `ODOO_SOURCE_DIR` may point at an existing local Odoo 19 checkout to avoid cloning.
- Default behavior: source is cached under `demo_v2/data/repo-cache/frameworks/odoo/19/source`.

- [ ] **Step 1: Run the full suite**

```bash
cd demo_v2
npm test
```

Expected: zero failures.

- [ ] **Step 2: Run ACME smoke test**

```powershell
node --input-type=module -e "import { ProgressiveRepositoryTopologyV9 } from './server/progressiveRepositoryTopologyV9.js'; const t=new ProgressiveRepositoryTopologyV9({cacheRoot:'./data/repo-cache'}); const r=await t.prepare('https://github.com/thallukrish/acme-ems-odoo'); console.log(JSON.stringify({frameworkKind:r.frameworkKind,version:t.odooDetection?.version,project:t.odooEntitySchema?.schemaCount,framework:r.odooFramework,effective:t.entitySchemas.length,mrpProduction:t.entitySchema('mrp.production'),mrpBom:t.entitySchema('mrp.bom')},null,2));"
```

Expected evidence:

```text
frameworkKind = odoo
version = 19
mrp.production ownership = composed
mrp.production contains both standard Odoo fields and ACME ems_* fields
mrp.bom resolves from the framework map
Odoo framework map exists under data/semantic-maps/frameworks/odoo/19/map.json
```

- [ ] **Step 3: Run the same ACME smoke test a second time**

Expected: `reused > 0`; already persisted Odoo schemas are reused rather than rediscovered.

- [ ] **Step 4: Update README**

Document:

```text
ACME project source → project schemas
referenced standard models → targeted Odoo 19 source resolution
Odoo 19 framework schemas → reusable framework map
framework + project schemas → effective schema catalog
```

Also state explicitly that Odoo framework workflow/call-path injection is not part of this slice.

- [ ] **Step 5: Commit**

```bash
git add ../lemap-odoo/README.md
git commit -m "docs: describe Odoo framework map enrichment"
```

---

## Self-review against the architecture spec

- Project-driven targeted learning: Tasks 1, 2, 4.
- Official-source provenance and stable IDs: Tasks 2, 4.
- Reusable versioned framework persistence: Task 3.
- Project/framework ownership separation: Tasks 3, 4, 5.
- Effective map composition: Tasks 5, 6.
- Existing Moqui path remains isolated: Task 6 and global constraints.
- Incremental reuse on subsequent runs: Tasks 3, 4, 7.
- No full Odoo semantic crawl: Task 2 uses targeted `git grep`; Task 4 bounds traversal to one hop / 60 models.
- No hard-coded ACME answers: all seeds arise from parsed project schemas.
- Deferred intentionally: Odoo framework execution/call-path injection into Pass 1/Pass 2; generic cross-framework layered-map refactor.
