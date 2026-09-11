# LeMap Web v2 Layer 1 Browser / DOM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first LeMap Web v2 layer that captures the current visible DOM as a hierarchy of structural facts without UI-control interpretation, graph construction, workflow logic, or LLM semantics.

**Architecture:** `captureVisibleDom(page)` obtains the current page body from the browser and delegates to a self-contained `scanDomTree(root)` function that can run inside the browser context. The scanner preserves visible DOM hierarchy and direct text, exposes only a conservative allow-list of structural attributes, and deliberately excludes live/user values; later adapter and orchestrator layers will interpret this raw local structure.

**Tech Stack:** Node.js ESM, built-in `node:test`; browser API compatible with Playwright's `locator(...).elementHandle().evaluate(...)` contract.

**Spec:** `lemap-web/docs/superpowers/specs/2026-09-11-lemap-web-architecture-requirements.md`

## Global Constraints

- New implementation lives only under `lemap_web_v2`.
- Layer 1 observes visible DOM structure only and assigns no control or business semantics.
- The DOM hierarchy must be preserved.
- Text-bearing ordinary containers remain available to later layers.
- Live/user field values must not be captured by this structural layer.
- No graph, grouping, workflow, model, or execution policy is implemented in this layer.

---

### Task 1: Visible DOM structural scanner

**Files:**
- Create: `lemap_web_v2/src/browser/domScanner.js`
- Create: `lemap_web_v2/test/domScanner.test.js`
- Create: `lemap_web_v2/package.json`

**Interfaces:**
- Consumes: a DOM root element for `scanDomTree(root)`; a Playwright-compatible page for `captureVisibleDom(page)`.
- Produces: `scanDomTree(root) -> DomNode | null` and `captureVisibleDom(page) -> { version, url, title, root }`.

- [ ] **Step 1: Write the failing tests** for hierarchy preservation, visibility filtering, ignored non-content branches, structural attribute allow-listing, exclusion of the `value` attribute, and page metadata capture.
- [ ] **Step 2: Run `node --test test/domScanner.test.js`** and verify failure because `src/browser/domScanner.js` does not yet exist.
- [ ] **Step 3: Implement `scanDomTree(root)`** as a self-contained browser-serializable function using direct text nodes, visible child recursion, an ignored-tag set, and a conservative structural attribute allow-list.
- [ ] **Step 4: Implement `captureVisibleDom(page)`** to resolve the body element, evaluate `scanDomTree` inside the browser context, and return page metadata plus the tree.
- [ ] **Step 5: Run `node --test test/domScanner.test.js`** and verify all Layer 1 tests pass.
- [ ] **Step 6: Commit Layer 1 on the isolated feature branch** and stop for user review before implementing the adapter layer.
