# Depth-First Replay Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a depth-first local replay simulator for LeMap Web v2 so previously captured pages can be debugged repeatedly without login, while live Playwright remains the source of truth for verification and discovery of the next uncaptured page.

**Architecture:** Add a separate `simulator/` subsystem that persists safe structural page fixtures and observed transitions, serves browser-interactable replay pages, and runs the existing LeMap execution pipeline against them. Live mode reuses the same entity/workflow/instance state and normal executor/adapter stack, verifies the known path from Page 1, and captures the first unknown destination to extend the replay frontier.

**Tech Stack:** Node.js ESM, `node:test`, Playwright Core, existing LeMap Web v2 graph/workflow/instance persistence and adapter/execution layers.

**Spec:** `lemap_web_v2/docs/superpowers/specs/2026-09-13-depth-first-replay-simulator.md`

## Global Constraints

- No website-, filing-, label-, route-, or page-specific logic in generic LeMap Web or simulator code.
- Framework-specific browser mechanics remain inside framework adapters.
- Replay fixtures contain structure/behavior only; runtime values remain in the instance graph.
- Simulator and live modes must use the same decision/execution/control-adapter pipeline.
- The simulator never invents an uncaptured page; it stops at a replay frontier.
- Capture grows depth-first along the path actually selected by the user.
- Live Playwright verification is required before a simulator-derived fix is considered verified.
- Raw HTML is not the canonical replay artifact.

---

## File Structure

Create these focused units under the new simulator subsystem:

```text
lemap_web_v2/
  simulator/
    src/
      fixtureSchema.js        # validate/normalize replay manifests, pages and transitions
      fixtureStore.js         # load/save replay fixtures atomically
      captureAdapter.js       # convert safe browser snapshots into replay page fixtures
      replayServer.js         # serve browser-interactable pages from fixtures
      replayRuntime.js        # start/stop simulator browser target and expose start URL
      frontier.js             # detect/represent UNKNOWN transition frontier
    fixtures/                 # runtime-created workflow fixtures; no checked-in personal data
    test/
      fixtureSchema.test.js
      fixtureStore.test.js
      captureAdapter.test.js
      replayServer.test.js
      frontier.test.js
  src/
    app/
      applicationRunner.js    # return explicit replay-frontier stop reason when browser says frontier
      bootstrap.js            # select live vs simulator browser runtime without changing runner contracts
    browser/
      browserSession.js       # keep live CDP; add no simulator-specific logic here
  test/
    simulatorIntegration.test.js
    liveReplayContract.test.js
```

The simulator may import safe structural types/contracts from `src/`, but `src/` must not import website-specific simulator fixture data.

---

### Task 1: Replay Fixture Contract

**Files:**
- Create: `lemap_web_v2/simulator/src/fixtureSchema.js`
- Create: `lemap_web_v2/simulator/test/fixtureSchema.test.js`

**Interfaces:**
- Produces: `normalizeReplayFixture(input)` -> canonical `{version, workflowId, startPageId, frontier, pages, transitions}`.
- Produces: `validateReplayPage(page)` and `validateReplayTransition(transition)`.
- Transition shape: `{fromPageId, actionEntityId, toPageId}` where `toPageId` may be `null` to represent frontier/unknown.
- Page shape: `{pageId, snapshot}` where `snapshot` is the same safe structural snapshot consumed by `ingestPageVisit()`.

- [ ] **Step 1: Write failing fixture-schema tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReplayFixture } from '../src/fixtureSchema.js';

test('normalizes a depth-first replay fixture with an unknown frontier', () => {
  const fixture = normalizeReplayFixture({
    version: 1,
    workflowId: 'wf:1',
    startPageId: 'page:a',
    pages: [{ pageId: 'page:a', snapshot: { version: 1, url: '/a', title: 'A', root: { tag: 'body', attributes: {}, directText: '', children: [] } } }],
    transitions: [{ fromPageId: 'page:a', actionEntityId: 'control:next', toPageId: null }]
  });

  assert.equal(fixture.startPageId, 'page:a');
  assert.equal(fixture.transitions[0].toPageId, null);
  assert.equal(fixture.frontier.fromPageId, 'page:a');
  assert.equal(fixture.frontier.actionEntityId, 'control:next');
});
```

Also assert rejection of duplicate page IDs, transitions whose source page is absent, fixtures containing runtime-value keys (`value`, `instances`, `cookie`, `authorization`, `token`), and multiple competing outgoing transitions for the same `(fromPageId, actionEntityId)` pair.

- [ ] **Step 2: Run the focused test and confirm RED**

```powershell
node --test simulator/test/fixtureSchema.test.js
```

Expected: module/function missing.

- [ ] **Step 3: Implement the minimal schema module**

```js
const FORBIDDEN_KEYS = new Set(['value', 'values', 'instance', 'instances', 'cookie', 'cookies', 'authorization', 'token', 'password', 'secret']);

export function normalizeReplayFixture(input = {}) {
  // clone, validate version/workflow/start page, validate unique pages/transitions,
  // recursively reject forbidden keys, derive single frontier from null transition.
}
```

Do not introduce domain terms. Treat page/action IDs as opaque canonical IDs.

- [ ] **Step 4: Run focused tests and confirm GREEN**

```powershell
node --test simulator/test/fixtureSchema.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lemap_web_v2/simulator/src/fixtureSchema.js lemap_web_v2/simulator/test/fixtureSchema.test.js
git commit -m "feat(simulator): define replay fixture contract"
```

---

### Task 2: Fixture Persistence

**Files:**
- Create: `lemap_web_v2/simulator/src/fixtureStore.js`
- Create: `lemap_web_v2/simulator/test/fixtureStore.test.js`

**Interfaces:**
- Consumes: `normalizeReplayFixture()`.
- Produces: `loadReplayFixture(filePath)`.
- Produces: `saveReplayFixture(filePath, fixture)` using temp-file + rename semantics.
- Produces: `upsertReplayPage(fixture, page)` and `upsertReplayTransition(fixture, transition)` as pure functions.

- [ ] **Step 1: Write failing persistence tests**

Test that saving then loading preserves the canonical fixture, transition upsert replaces an existing unknown transition with a known destination, and page upsert is idempotent by `pageId`.

```js
const updated = upsertReplayTransition(fixture, {
  fromPageId: 'page:a',
  actionEntityId: 'control:next',
  toPageId: 'page:b'
});
assert.equal(updated.transitions[0].toPageId, 'page:b');
assert.equal(updated.frontier, null);
```

- [ ] **Step 2: Run focused test and confirm RED**

```powershell
node --test simulator/test/fixtureStore.test.js
```

- [ ] **Step 3: Implement persistence without leaking runtime values**

Use `fs.readFile`, `fs.mkdir`, `fs.writeFile` to a sibling temp path, then `fs.rename`. Always normalize before write and after read.

- [ ] **Step 4: Run focused tests and confirm GREEN**

```powershell
node --test simulator/test/fixtureStore.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lemap_web_v2/simulator/src/fixtureStore.js lemap_web_v2/simulator/test/fixtureStore.test.js
git commit -m "feat(simulator): persist replay fixtures safely"
```

---

### Task 3: Live Snapshot -> Replay Page Capture

**Files:**
- Create: `lemap_web_v2/simulator/src/captureAdapter.js`
- Create: `lemap_web_v2/simulator/test/captureAdapter.test.js`

**Interfaces:**
- Consumes: the safe structural snapshot already returned by `captureVisibleDom(page)`.
- Produces: `captureReplayPage({snapshot, pageId})` -> `{pageId, snapshot}`.
- Produces: `recordObservedTransition({fixture, fromPageId, actionEntityId, toPageId})` where `toPageId=null` marks unknown frontier.

- [ ] **Step 1: Write failing capture tests**

Verify capture preserves visible hierarchy, safe attributes, labels, roles and option structure already present in the snapshot; verify it does not accept arbitrary raw HTML or runtime instance data.

```js
assert.throws(() => captureReplayPage({
  pageId: 'page:a',
  snapshot: { html: '<input value="secret">' }
}), /safe structural snapshot/i);
```

- [ ] **Step 2: Run focused test and confirm RED**

```powershell
node --test simulator/test/captureAdapter.test.js
```

- [ ] **Step 3: Implement capture as a thin structural adapter**

Do not create a second DOM parser. Reuse the existing safe snapshot contract and reject unsupported/raw fields.

- [ ] **Step 4: Run focused tests and confirm GREEN**

```powershell
node --test simulator/test/captureAdapter.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lemap_web_v2/simulator/src/captureAdapter.js lemap_web_v2/simulator/test/captureAdapter.test.js
git commit -m "feat(simulator): capture safe replay pages"
```

---

### Task 4: Generic Replay Server

**Files:**
- Create: `lemap_web_v2/simulator/src/replayServer.js`
- Create: `lemap_web_v2/simulator/src/frontier.js`
- Create: `lemap_web_v2/simulator/test/replayServer.test.js`
- Create: `lemap_web_v2/simulator/test/frontier.test.js`

**Interfaces:**
- Produces: `createReplayServer({fixture, host='127.0.0.1', port=0})` -> `{baseUrl, close()}`.
- Produces: `frontierResult({fromPageId, actionEntityId})` -> stable replay-frontier payload.
- Browser routes are simulator-internal, e.g. `/replay/<encoded-page-id>`.
- Clicking a known transition navigates to the destination replay page.
- Clicking an unknown transition navigates to a simulator frontier endpoint/page whose DOM exposes a generic machine-readable marker, e.g. `data-lemap-replay-frontier="true"`, `data-from-page-id`, `data-action-entity-id`.

- [ ] **Step 1: Write failing browser-rendering tests**

Render fixtures containing native text input, native select, generic combobox/role-option, radio, checkbox, button/link, and one unknown transition. Assert DOM remains generic and uses fixture structure only.

```js
assert.match(html, /role="combobox"/);
assert.match(html, /role="option"/);
assert.match(frontierHtml, /data-lemap-replay-frontier="true"/);
```

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
node --test simulator/test/replayServer.test.js simulator/test/frontier.test.js
```

- [ ] **Step 3: Implement deterministic rendering**

Use Node `http` only unless an existing project dependency already provides a server. The renderer must translate structural snapshot nodes to simple browser DOM, preserving tag/role/name/id/aria/required/disabled metadata required by current locators/adapters. Do not mimic source-site styling.

For controls requiring custom behavior, implement generic simulator behavior rather than framework-branded behavior. Example: a captured combobox is rendered as a host with `role="combobox"` and a hidden option container that exposes `role="option"` elements when clicked.

- [ ] **Step 4: Run focused tests and confirm GREEN**

```powershell
node --test simulator/test/replayServer.test.js simulator/test/frontier.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lemap_web_v2/simulator/src/replayServer.js lemap_web_v2/simulator/src/frontier.js lemap_web_v2/simulator/test/replayServer.test.js lemap_web_v2/simulator/test/frontier.test.js
git commit -m "feat(simulator): serve generic replay pages"
```

---

### Task 5: Simulator Runtime Using the Existing LeMap Runner

**Files:**
- Create: `lemap_web_v2/simulator/src/replayRuntime.js`
- Create: `lemap_web_v2/test/simulatorIntegration.test.js`
- Modify: `lemap_web_v2/src/app/bootstrap.js`
- Modify: `lemap_web_v2/src/app/applicationRunner.js`

**Interfaces:**
- Produces: `startReplayRuntime({fixture, chromium})` -> `{page, close, mode:'simulator'}`.
- Runner receives an ordinary Playwright `page`; it must not branch on website/domain.
- Runner returns `{reason:'replay_frontier', frontier:{fromPageId, actionEntityId}, ...}` when the simulated browser reaches the frontier marker.

- [ ] **Step 1: Write failing integration test proving shared execution path**

Construct a fixture with Page A containing a required input and a button to Page B. Seed the normal instance graph with the input value. Start replay runtime and call the existing `runApplication()`; assert the value is applied through normal decision execution and navigation reaches B.

Also assert no simulator-specific executor is injected.

- [ ] **Step 2: Write failing frontier-stop test**

Fixture: A -> B known, B -> UNKNOWN. Assert runner returns `reason === 'replay_frontier'` and does not synthesize another page.

- [ ] **Step 3: Run focused integration tests and confirm RED**

```powershell
node --test test/simulatorIntegration.test.js
```

- [ ] **Step 4: Implement replay runtime and minimal runner frontier recognition**

`replayRuntime.js` starts `createReplayServer()`, launches/attaches a local Playwright browser page, and opens the fixture start page. `applicationRunner.js` should detect the generic frontier marker only at the browser-observation boundary and return a stop reason; no domain semantics are added.

`bootstrap.js` should choose the session provider from config/mode while still passing an ordinary `{page, close}` session to `runApplication()`.

- [ ] **Step 5: Run focused tests and confirm GREEN**

```powershell
node --test test/simulatorIntegration.test.js
```

- [ ] **Step 6: Run full suite**

```powershell
npm test
```

- [ ] **Step 7: Commit**

```bash
git add lemap_web_v2/simulator/src/replayRuntime.js lemap_web_v2/test/simulatorIntegration.test.js lemap_web_v2/src/app/bootstrap.js lemap_web_v2/src/app/applicationRunner.js
git commit -m "feat(simulator): run LeMap against captured replay pages"
```

---

### Task 6: Live Verification Contract and Automatic Frontier Extension

**Files:**
- Create: `lemap_web_v2/test/liveReplayContract.test.js`
- Modify: `lemap_web_v2/src/app/bootstrap.js`
- Modify: `lemap_web_v2/src/app/applicationRunner.js`
- Modify: `lemap_web_v2/simulator/src/fixtureStore.js`
- Modify: `lemap_web_v2/simulator/src/captureAdapter.js`

**Interfaces:**
- Live mode starts from the user-opened known Page 1.
- It loads the same persisted entity/workflow/instance graphs.
- Existing reusable inputs are applied through `applyReusableInput()` and normal `executeControlAction()`/adapter handling.
- When a known transition lands on a page absent from the fixture, live mode captures that new safe snapshot and updates the fixture transition from `null` to the new `pageId`.
- Produces a result such as `{reason:'frontier_extended', capturedPageIds:[...]}`.

- [ ] **Step 1: Write failing contract test for known-path live replay**

Use dependency-injected fake Playwright/session objects, not a website-specific fixture. Assert stored instances are replayed in traversal order using existing reusable-input logic before the unknown destination is captured.

- [ ] **Step 2: Write failing contract test for frontier extension**

Start with fixture A -> UNKNOWN. Simulate live action producing structural Page B. Assert fixture after run contains Page B and transition A/action -> B.

- [ ] **Step 3: Run focused tests and confirm RED**

```powershell
node --test test/liveReplayContract.test.js
```

- [ ] **Step 4: Implement capture-at-first-unknown-page**

Keep page identity based on the existing canonical page entity calculation. Persist only the safe snapshot via `captureReplayPage()`. Do not copy instance values into the fixture.

- [ ] **Step 5: Run focused tests and confirm GREEN**

```powershell
node --test test/liveReplayContract.test.js
```

- [ ] **Step 6: Run full suite**

```powershell
npm test
```

- [ ] **Step 7: Commit**

```bash
git add lemap_web_v2/test/liveReplayContract.test.js lemap_web_v2/src/app/bootstrap.js lemap_web_v2/src/app/applicationRunner.js lemap_web_v2/simulator/src/fixtureStore.js lemap_web_v2/simulator/src/captureAdapter.js
git commit -m "feat(simulator): extend replay frontier from live verification"
```

---

### Task 7: CLI Commands for Capture/Replay/Live Verification

**Files:**
- Modify: `lemap_web_v2/src/app/cli.js`
- Modify: `lemap_web_v2/package.json`
- Create: `lemap_web_v2/simulator/test/cliContract.test.js`

**Interfaces:**
- Preserve the current default live command.
- Add explicit generic modes, for example:
  - `npm run replay -- "<query>" --fixture <path>`
  - `npm run live -- "<query>" --fixture <path>`
- The CLI passes mode/fixture config to bootstrap; it does not contain workflow-specific logic.

- [ ] **Step 1: Write failing CLI parsing tests**

Assert replay/live modes resolve to a normalized runtime config and reject missing fixture paths in simulator mode.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
node --test simulator/test/cliContract.test.js
```

- [ ] **Step 3: Implement minimal CLI/config plumbing**

Keep query text separate from flags. Do not add current-site names to commands or config.

- [ ] **Step 4: Add package scripts**

Example:

```json
{
  "scripts": {
    "start": "node src/app/cli.js",
    "replay": "node src/app/cli.js --mode simulator",
    "live": "node src/app/cli.js --mode live"
  }
}
```

Retain the explicit Windows-compatible test file enumeration already used by this project; add the new simulator tests to it.

- [ ] **Step 5: Run focused + full tests**

```powershell
node --test simulator/test/cliContract.test.js
npm test
```

- [ ] **Step 6: Commit**

```bash
git add lemap_web_v2/src/app/cli.js lemap_web_v2/package.json lemap_web_v2/simulator/test/cliContract.test.js
git commit -m "feat(simulator): expose replay and live verification modes"
```

---

### Task 8: End-to-End Depth-First Ratchet Verification

**Files:**
- Create: `lemap_web_v2/simulator/test/depthFirstRatchet.test.js`
- Modify only files proven necessary by failures from this test.

**Interfaces:**
- End-to-end scenario is generic: Page A -> Page B -> UNKNOWN, then live capture extends to Page C, then the next simulator run traverses A -> B -> C with no live browser.

- [ ] **Step 1: Write the failing ratchet test**

The test must prove all of these in order:

```text
capture A
replay A repeatedly
capture B from live transition
replay A -> B repeatedly
stop at B -> UNKNOWN
live replay from A using persisted instance values
capture C
replay A -> B -> C locally
```

Assert fixture contains only the chosen path; no sibling page appears.

- [ ] **Step 2: Run the ratchet test and confirm RED if integration gaps remain**

```powershell
node --test simulator/test/depthFirstRatchet.test.js
```

- [ ] **Step 3: Make only the minimal fixes required by the ratchet test**

No new abstraction unless the test exposes a real boundary issue. Keep framework-specific mechanics in adapters.

- [ ] **Step 4: Run ratchet + full suite**

```powershell
node --test simulator/test/depthFirstRatchet.test.js
npm test
```

Expected: all pass.

- [ ] **Step 5: Perform first manual live verification**

User logs in and opens the known workflow start page. Run live mode with the fixture and existing instance graph. Verify the known captured pages are traversed through real Playwright controls and the first uncaptured page is persisted.

Record only safe structural diagnostics; do not commit personal fixture/runtime data.

- [ ] **Step 6: Commit final integration adjustments**

```bash
git add lemap_web_v2/simulator lemap_web_v2/src lemap_web_v2/test lemap_web_v2/package.json
git commit -m "test(simulator): verify depth-first replay ratchet"
```

---

## Branch Consolidation Before Execution

Before Task 1 implementation, consolidate the current accepted Layer 27 work and subsequent approved fixes onto one canonical LeMap Web v2 development branch. Recommended branch name: `lemap-web-v2`.

Do this as a repository-management step before implementation, not as simulator code. Verify the selected source head contains the latest approved commits, create/update `lemap-web-v2` from that head, and run the current full suite to establish the baseline. Do not delete historical branches until the canonical branch is verified.

Future issue debugging should use one branch per issue, e.g. `fix-repeat-required-input`, with multiple iteration commits on that same branch.

## Verification Gates

A simulator-related change is complete only when:

1. focused task tests pass;
2. `npm test` passes;
3. simulator integration passes on captured fixtures;
4. for browser-interaction fixes, one live Playwright verification traverses the same known path from Page 1 using persisted instance values;
5. replay fixtures contain no runtime values/auth/session material;
6. no website-specific code appears outside runtime fixture data.

## Deferred Work

Do not implement the MCP fix-loop or fix skill in this plan. After the replay simulator and live frontier extension are stable, create a separate spec/plan for:

- local LeMap Dev MCP operations (`pull`, `test`, `replay`, `live-verify`, `read-log`, branch lifecycle);
- bounded fix-session orchestration with default `max_iterations=10`;
- one temporary fix branch per issue;
- automatic merge/cleanup on verified success;
- stop-and-summarize when the iteration budget is exhausted.
