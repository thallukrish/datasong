# DataSong demo_v2 — Semantic Explorer

This is the current experiment for the semantic-exploration architecture in `docs/SEMANTIC_EXPLORATION_ARCHITECTURE.md`.

It intentionally does **not** start with predefined workflows, concepts, rules, or persistence checklists.

The code-source experiment is now **symbol-first rather than file-first**.

The demo:

1. clones/caches a repository;
2. parses supported code/XML sources locally into functions, methods, services, transitions and other named executable symbols;
3. builds a deterministic local symbol/action graph with edges such as `calls`, `called_by`, `routes_to`, `reads` and `writes`;
4. exposes symbols and their bounded bodies/signatures to the LLM; file paths and line ranges are provenance only;
5. asks the LLM to interpret the business meaning of the observed symbol, attach it to an end-to-end vertical slice, and identify semantic gaps/branches;
6. follows local graph edges when they provide the causal/operational continuation, using semantic search only when the needed continuation is not in the local neighborhood;
7. repeats until one vertical slice reaches semantic closure (100%) or the exploration budget is exhausted.

## Why symbol-first

Files are storage/container boundaries and often mix unrelated behavior. Function/service/transition boundaries are much closer to the semantic units that make up an enterprise use case.

The intended separation is:

```text
repository
   ↓
local parser / symbol graph
   ↓
functions + methods + services + transitions
   ↓
call/reference topology
   ↓
LLM semantic interpretation
   ↓
vertical slice
```

The LLM should not spend tokens rediscovering the repository's mechanical structure.

## Run

```powershell
cd demo_v2
npm install
$env:DEEPSEEK_API_KEY="..."
$env:DEEPSEEK_MODEL="deepseek-v4-flash"   # optional
npm start
```

Open `http://localhost:3102`.

## Console output

Exploration deliberately keeps the console terse. Every LLM call prints token use, including reasoning tokens:

```text
[LLM #7] slices: Customer places an order 42% | tokens +742 (prompt 575, completion 167, reasoning 0) | cumulative 5114
```

No symbol bodies, prompts, candidate graph nodes, or model responses are dumped to the console.

## Detailed run log

Every exploration run writes a JSONL trace under:

```text
data/runs/<run-id>.jsonl
```

Each LLM-call record includes:

- observed symbol and provenance
- bounded symbol body/signature
- local call/reference candidates presented to the model
- semantic board before the call
- exact prompt
- raw model response
- parsed semantic update
- per-call token usage
- cumulative token usage

This log is intended for replay/debugging and policy analysis.

## Important demo rules

- Code inside the supplied repo is parsed locally; files are provenance, not semantic exploration nodes.
- Mechanical call/reference structure is deterministic topology, not something the LLM should infer repeatedly.
- A branch is part of the current vertical slice and keeps the parent incomplete until explored or explicitly bounded.
- A reusable local sub-flow becomes a semantic dependency/sub-flow rather than being recursively inlined.
- An external library/API is treated as a black box; only the input/output/effect needed by the local slice is retained.
- Progress is semantic closure, not percentage of files or symbols visited. It may go backward when important new evidence changes the known shape of the slice.
