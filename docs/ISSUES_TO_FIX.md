# LeMap issues to fix

This is a dated observation log for implementation findings. An entry is not considered fixed until its behavior has been verified on the relevant branch. Do not treat untested risks as confirmed defects.

**Repository:** `thallukrish/datasong`  
**Inspected branch:** `feature/semantic-profiles-code-flow`  
**Observation date:** 2026-10-12 (Asia/Kolkata)  
**Status:** Open, pending validation

## LEMAP-001 — Query-v5 ledger variable is out of scope

- **Observed:** 2026-10-12
- **Severity:** High, potential runtime blocker
- **Status:** Open, needs reproduction and fix
- **File:** `demo_v2/server/query_v5/queryEngine.js`
- **Observation:** The functions `applyLedgerDecision({ledger,...})`, `decide({ledger,...})`, and `assessCausalCompleteness({ledger,...})` reference `branchLedger` although it is not defined within their lexical scopes. They each receive a `ledger` parameter. For example, `applyLedgerDecision` iterates `branchLedger.values()` and writes `branchLedger.set(...)`; `decide` constructs `f: ledgerView(branchLedger)`. These code paths appear capable of throwing `ReferenceError`.
- **Suggested fix:** Replace the invalid references in those functions with their scoped `ledger` parameter. Check for any other unexpected `branchLedger` references, while preserving correctly declared branch-local ledgers inside the main traversal loop.
- **Validation:** Add focused tests exercising initial entry decisions, facts added/updated/disputed, completeness checks, and backtracking. Run Query-v5 with a real issue and confirm no reference errors.
- **Acceptance:** Every ledger operation uses the intended scoped ledger, and Query-v5's entry, traversal and causal-completeness paths execute successfully.

## LEMAP-002 — Rolling semantic-window depth mismatches documented contract

- **Observed:** 2026-10-12
- **Severity:** Medium, behavioral/configuration discrepancy
- **Status:** Open, decision required
- **Files:** `demo_v2/server/query_v5/queryEngine.js`, `docs/CODE_LEARN_QUERY.md`
- **Observation:** The implementation sets `const WINDOW_DEPTH = 1`, whereas the code Learn/Query document repeatedly specifies a three-call-level rolling semantic window. It is not yet established whether the depth of one is an intentional experiment or a regression.
- **Suggested fix:** Confirm the intended semantic window contract. If three levels are still intended, set the depth consistently and add coverage for lazy expansion from a newly selected node. If one level is intentional, update the specification and explain the tradeoff.
- **Validation:** Test a chain with at least four reachable call levels and verify the actual semantic neighborhood at initial entry and after traversal, including reuse of previously learned semantics.
- **Acceptance:** Documented and executed window depths agree.

## LEMAP-003 — Evidence-ledger correctness across backtracking and causal stopping needs regression coverage

- **Observed:** 2026-10-12
- **Severity:** Medium, investigation reliability risk (not yet a confirmed defect)
- **Status:** Open, validation task
- **Files:** `demo_v2/server/query_v5/queryEngine.js`, `docs/CODE_LEARN_QUERY.md`
- **Observation:** Query-v5 implements evidence accumulation, fact deduplication, dispute/resolution states, branch hypothesis restoration, and causal stop decisions. Their combined correctness has not been validated in this review. In particular, check that supported facts remain available across branch changes without allowing an unsupported or disputed fact to justify issue closure.
- **Suggested fix:** Add targeted end-to-end regressions for a wrong first branch, return to an alternative branch, contradictions, duplicate facts, and multi-part bug reports. Fix any actual failing paths rather than assuming the risk is a defect.
- **Validation:** Verify branch hypotheses restore appropriately, evidence remains appropriately associated with its source, disputed claims cannot justify completion, and full-issue causal stopping requires support for every material symptom.
- **Acceptance:** Tests demonstrate evidence preservation and properly grounded stop conditions under backtracking and contradiction.

---

## Maintenance convention

When an issue is addressed, retain its original observation date; add a **Fixed on** date, branch/commit, validation command/result, and change the status to **Verified fixed** only after running the relevant regression. Keep unverified observations marked as such.
