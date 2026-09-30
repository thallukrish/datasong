# SWE-Explore evaluation

LeMap uses SWE-Explore as the external benchmark for generic repository exploration.

The benchmark contract is deliberately outside the exploration algorithm:

```text
issue + repository snapshot
→ language structural adapter
→ canonical LeMap graph
→ query-independent semantic Learn
→ Query v5 causal/query exploration
→ ranked source regions
→ SWE-Explore evaluator
```

## Query v5 benchmark output

A completed Query v5 result exposes:

```json
{
  "sweExplore": {
    "regions": [
      {"rank": 1, "path": "pkg/file.py", "start": 10, "end": 25}
    ]
  }
}
```

These are the final ranked evidence regions and are the values to pass to the SWE-Explore evaluator.

The exploration algorithm must not receive SWE-Explore ground truth.

## Diagnostic output

Each Query v5 result also exposes a `diagnostics` block. This is for LeMap development only and is not a replacement for SWE-Explore metrics.

Recorded diagnostics:

- total LLM prompt, completion and total tokens
- semantic nodes newly learned during the query
- unique nodes exposed through semantic windows
- functions actually traversed
- ordered traversed regions
- ordered semantic-window regions read
- number of descents
- number of backtracks
- number of reseeds
- number of Query decision steps
- first step at which an evidence fact entered the ledger
- convergence step

SWE-Explore ground truth can be joined after the run to derive diagnostic values such as first core-region hit. Ground truth must never be supplied to Query itself.

## Evaluation policy

Start with Python because the current structural adapter is Python AST based.

Keep Query v5, Learn, evidence ledger, causal scoring, backtracking and localization language-independent. Adding another language should require only the structural adapter to produce the same canonical nodes and executable relationships.

For every benchmark failure classify the primary cause as one of:

```text
parser / unresolved relationship
entry ranking
semantic learning
causal or query scoring
traversal / backtracking
convergence
localization / returned-region ranking
```

Use the official SWE-Explore metrics for benchmark claims. LeMap diagnostics are only for explaining changes in those scores.

## Initial Python validation

The next controlled case is:

```text
SWE-Explore instance
pydata__xarray-4629

Underlying reported bug
xarray merge(combine_attrs="override") returns the first source attrs by reference.
Changing attrs on the merged Dataset therefore mutates attrs on the first source Dataset.
The expected behavior is an independent copy.
```

The public SWE-Explore record identifies core context in:

```text
xarray/core/combine.py
xarray/core/concat.py
xarray/core/merge.py
xarray/tests/test_merge.py
```

For this SWE-bench instance, PR 4629 fixes issue 4627 and the pre-fix base commit is:

```text
a41edc7bf5302f2ea327943c0c48c532b12009bc
```

Use that snapshot. Do not run the benchmark against current xarray or the repaired commit.

Run LeMap only from the issue and repository snapshot. Compare its returned ranked regions with SWE-Explore ground truth afterward.
