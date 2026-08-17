# DataSong demo_v2 — Semantic Explorer

This is a clean experiment for the semantic-exploration architecture in `docs/SEMANTIC_EXPLORATION_ARCHITECTURE.md`.

It intentionally does **not** start with predefined workflows, concepts, rules, or persistence checklists.

The demo:

1. clones/caches a repository;
2. exposes a deterministic code topology (directory hierarchy, local references, imports/service calls, and searchable local artifacts);
3. presents one observed artifact plus a bounded frontier to the LLM;
4. asks the LLM to interpret meaning, attach/update semantic stories and branches, identify local sub-flows vs external black boxes, estimate closure, and choose the next highest-information-gain action;
5. repeats until one story reaches semantic closure (100%) or the exploration budget is exhausted.

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

Exploration deliberately keeps the console terse. Every LLM call prints only:

```text
[LLM #7] stories: Customer places order 78% | Payment processing 22% | tokens +1542 (prompt 1180, completion 362) | cumulative 9184
```

No source excerpts, prompts, candidate artifacts, or model responses are dumped to the console.

## Detailed run log

Every exploration run writes a JSONL trace under:

```text
data/runs/<run-id>.jsonl
```

Each LLM-call record includes:

- observed artifact and bounded excerpt/summary
- topology candidates presented to the model
- semantic board before the call
- exact prompt
- raw model response
- parsed semantic update
- selected next action
- per-call token usage
- cumulative token usage

This log is intended for replay/debugging and policy analysis.

## Important demo rules

- Code inside the supplied repo is considered local evidence and should be explored before crossing external boundaries.
- A branch is part of the current story and keeps the parent story incomplete until explored or explicitly bounded.
- A reusable local sub-flow becomes a separately tracked story with a semantic contract; it is not recursively inlined into the parent.
- An external library/API is treated as a black box. The model records only the input/output/effect needed to continue the local story.
- Progress is semantic closure, not percentage of files visited. It may go backward when an important new branch is discovered.
