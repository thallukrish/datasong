# LeMap Web v2 — Depth-First Replay Simulator Architecture

Date: 2026-09-13

## Purpose

LeMap Web needs a fast development and debugging loop that does not require repeated login to authenticated websites after every code change.

The simulator provides a local replay environment for pages that LeMap Web has already visited and learned. The real website remains the source of truth for first-time discovery of each new page and for final integration verification.

The replay model is **depth-first, not breadth-first**. LeMap captures only the workflow path the user actually selects. For example, if the user chooses one filing flow, LeMap follows and captures only that selected path. It does not attempt to discover sibling workflows or unrelated pages.

## Core Principle

> Live browser discovers the frontier. Simulator replays everything behind the frontier.

The simulator is an acceleration layer for testing. It is not a replacement for the real browser and is not the authoritative source of website behavior.

## Scope and Location

The simulator is a separate subsystem under LeMap Web v2:

```text
lemap_web_v2/
  src/
  test/
  simulator/
    src/
    fixtures/
    test/
```

Core LeMap Web must not contain simulator-specific website logic. The simulator may depend on generic LeMap Web contracts, but LeMap Web runtime code must remain usable unchanged against arbitrary websites.

## Architectural Invariants

1. No code may be specific to the current test website, filing type, labels, routes, or page names.
2. Framework-specific behavior remains inside framework adapters.
3. Core runtime continues to operate on generic entities, groups, relationships, frames, workflow state, and instance state.
4. Replay fixtures contain structural/browser behavior, never user-entered instance values.
5. Instance values remain in the instance graph and are applied through the normal execution pipeline.
6. The same execution path used in simulator mode must be exercised again in live Playwright mode before a fix is considered verified.
7. The simulator never invents an uncaptured next page. Reaching an unknown destination is the replay frontier.
8. Capture grows only along the path selected by the user.

## Persistent State Separation

The architecture preserves the existing separation of concerns:

```text
Replay fixture = captured website structure and observed behavior
Entity graph   = learned semantic and structural map
Instance graph = local runtime/user values
Workflow graph = ordered traversal and replay frontier
```

User values must not be copied into replay fixtures.

## Page Capture

The canonical replay artifact is a **safe structural replay snapshot**, not raw saved HTML.

A captured page should preserve only the information needed to reproduce the browser behavior observed by LeMap, including:

- visible structural hierarchy
- generic control identity and control type
- safe attributes used by locators/adapters
- roles and labels required for interaction
- finite option labels when discovered
- group membership and cardinality
- dynamic branches and modal structure that were observed
- observed action-to-state and action-to-page transitions

Raw HTML may optionally be retained as a sanitized debugging artifact later, but it is not the replay contract because framework applications may not function correctly from saved HTML and raw HTML can contain sensitive/session data.

## Depth-First Capture Model

The workflow grows incrementally:

```text
Live Page A
  -> capture A

Simulator
  A can now be replayed repeatedly

Live A -> B
  -> capture B
  -> persist observed A -> B transition

Simulator
  A -> B can now be replayed repeatedly

Live A -> B -> C
  -> capture C
  -> persist observed B -> C transition

Simulator
  A -> B -> C can now be replayed repeatedly
```

Sibling paths are not explored unless the user explicitly selects them in a later workflow.

## Simulator Behavior

The simulator renders generic browser-interactable pages from replay fixtures. It does not need to reproduce the visual design of the source site.

It must reproduce the behavior required by LeMap's execution and adapter layers, such as:

- native inputs and selects
- generic combobox behavior
- role=option lists
- radio and checkbox groups
- buttons and links
- dynamic reveal/hide behavior
- modal or nested frame behavior
- observed navigation transitions

The simulator should expose ordinary browser DOM behavior so LeMap interacts through the same Playwright-facing mechanisms used in live mode.

## Replay Frontier

A replay fixture may contain known transitions and unknown transitions.

Example:

```text
Page A
  action X -> Page B

Page B
  action Y -> UNKNOWN
```

`UNKNOWN` means LeMap has never observed the destination in the live website.

When simulated execution reaches an unknown transition:

1. simulator execution stops cleanly at the frontier;
2. current entity graph, instance graph, workflow state, and frontier action are persisted;
3. the run reports that live capture is required;
4. no destination is synthesized locally.

## Live Verification and Frontier Extension

To extend the frontier, the user performs only the authentication/setup step:

1. user logs in to the real website;
2. user opens the known workflow start page (Page 1);
3. LeMap attaches through Playwright/CDP;
4. LeMap loads persisted entity/workflow/instance state;
5. LeMap applies persisted instance values to the real pages through the normal execution pipeline;
6. LeMap traverses the already-known workflow path automatically;
7. fixes developed against simulator pages are therefore exercised against the real UI controls;
8. when the first uncaptured destination is reached, LeMap captures the new live page;
9. the observed transition and new page fixture are persisted;
10. the simulator frontier advances by one or more newly observed pages.

The user does **not** manually position the browser at the frontier page. The user logs in and points LeMap at the known start page; LeMap replays the stored instance values and traverses the known path itself.

## Why Live Replay Is Required

Simulator success is necessary but not sufficient.

A framework adapter or browser interaction can work against the simulated representation while still failing against the real framework implementation. Therefore a fix is considered verified only after:

```text
unit tests pass
  -> simulator integration passes
  -> live Playwright replay of the same known path passes
```

The live run is also how the next uncaptured page is discovered.

## Runtime Modes

LeMap Web should eventually support two explicit execution modes using the same graph and execution contracts.

### Simulator mode

Used for the fast inner development loop.

```text
load fixture
load graph/workflow/instance state
run query
apply persisted or supplied values
traverse captured pages only
stop at completion or replay frontier
```

No authentication is required.

### Live mode

Used for integration verification and frontier extension.

```text
user authenticates and opens known start page
attach Playwright/CDP
load graph/workflow/instance state
reapply persisted instance values
traverse known path
verify real controls
capture first unknown page/transition
persist updated replay fixture
```

## Normal Execution Pipeline Must Be Shared

Both modes must exercise the same logical pipeline:

```text
instance graph
  -> agent decision
  -> generic decision execution
  -> control executor
  -> framework adapter when applicable
  -> browser interaction
```

Simulator-specific shortcuts must not bypass this path, otherwise simulator success would not validate the code used in live mode.

## Fixture Organization

The exact schema will be decided in the implementation plan, but fixtures should be organized by replay workflow rather than by website-specific code.

Conceptually:

```text
simulator/fixtures/<workflow-or-session>/
  manifest.json
  pages/
    <page-id>.json
  transitions.json
```

The manifest identifies the captured start page and replay frontier. Pages and transitions use canonical entity/page identifiers rather than domain-specific constants.

## Privacy and Safety

Replay capture must preserve the existing deny-by-default privacy model.

The fixture must not persist:

- entered field values
- authentication credentials
- cookies or authorization headers
- access/session tokens
- hidden sensitive DOM data merely because it exists in the source document
- arbitrary raw DOM/HTML by default

Runtime values continue to reside only in the local instance graph.

## Development Workflow

The intended debugging loop becomes:

```text
npm test
  -> simulator run
  -> inspect simulator/run log
  -> make minimal layered fix
  -> repeat
```

Once simulator execution succeeds:

```text
user logs in and opens Page 1
  -> live replay using persisted instances
  -> verify known captured pages against real controls
  -> capture next unknown page
  -> extend simulator fixture
```

Each page is therefore expensive only once during initial discovery. Repeated debugging of that page happens locally.

## Relationship to Automated Fix Sessions

The simulator should be implemented before the MCP-driven automated fix loop.

A later fix-session system can use one temporary branch per issue, not one branch per iteration:

```text
base branch
  -> fix-<issue>
       iteration 1 commit
       iteration 2 commit
       ...
```

The iteration budget is a hard limit, defaulting to 10 unless specified by the user.

Most iterations should use unit tests plus simulator replay. Live verification is requested only after the simulator passes or when the replay frontier needs extension.

The future MCP/skill layer will orchestrate this process, but it must respect the same architectural constraints:

- generic code only
- layer boundaries preserved
- framework-specific mechanics remain in adapters
- no current-site-specific patches
- previously solved mechanisms in older LeMap implementations should be inspected before inventing replacements

## Implementation Order

1. Consolidate the current LeMap Web v2 work onto one canonical development base branch.
2. Define replay fixture schema and capture contract.
3. Implement fixture persistence for live captures.
4. Implement simulator page rendering and transition handling.
5. Run the existing LeMap query pipeline against simulator pages.
6. Add replay-frontier detection and clean stop semantics.
7. Add live-mode resume from Page 1 using persisted instance values.
8. Capture and persist the first unknown page automatically.
9. Add simulator/live integration verification tests.
10. Only after this is stable, add MCP-driven fix-session automation and the corresponding skill.

## Success Criteria

The replay subsystem is successful when all of the following are true:

- a page visited once in live mode can be exercised repeatedly without logging in;
- replay follows only the user's selected workflow path;
- persisted instance values can drive simulator execution;
- the same persisted instance values can then drive the real website from Page 1 through Playwright;
- fixes made against simulated controls are verified against the corresponding real controls;
- the simulator stops at an unknown page instead of inventing it;
- a live run can capture that unknown page and extend the replay fixture;
- no website-specific behavior is introduced into generic LeMap Web layers;
- no user-entered values or authentication/session secrets are persisted in replay fixtures.
