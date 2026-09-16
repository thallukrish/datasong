# Odoo Configurable Pattern Registry

## Goal

Move Odoo structural recognition out of hard-coded adapter branches and into a small configurable regex registry so new Odoo implementation patterns can usually be added without changing adapter code.

## Design principle

Keep the mechanism simple.

```text
Odoo detection
  ↓
find Odoo-relevant files
  ↓
read file contents
  ↓
select configured regex rules by file pattern
  ↓
apply rules and capture values
  ↓
emit canonical LeMap structural facts
  ↓
existing Odoo execution expansion / CallPathIndexer
```

The registry is a recognition catalogue, not a second parser framework.

## Matching policy

Patterns should favor recall over strictness. They should tolerate ordinary formatting variation, whitespace, quote style, multiline XML where practical, and common Odoo coding styles.

A loose candidate match is preferable to silently missing relevant structural evidence. Precision can be improved after matching from captured context and existing adapter logic.

Do not build a custom pattern language. Use normal JavaScript regular expressions stored as strings plus simple metadata describing file applicability, capture names, emitted node type, relation, and evidence kind.

## Registry shape

Use a single JSON file for the first version.

Each entry contains:

- `id` unique rule name
- `files` one or more simple glob-like suffix/pattern selectors
- `flags` regex flags such as `gms`
- `regex` regex source string
- `captures` mapping from semantic names to regex capture indexes
- `emit` small declarative description of the structural fact

Example:

```json
{
  "id": "manifest_post_init_hook",
  "files": ["**/__manifest__.py"],
  "regex": "['\"]post_init_hook['\"]\\s*:\\s*['\"]([^'\"]+)['\"]",
  "flags": "g",
  "captures": { "function": 1 },
  "emit": { "kind": "entrypoint", "relation": "triggers", "evidence": "configured" }
}
```

The adapter may attach source path, line, addon, model context, and provenance when emitting the fact.

## Initial patterns

The first registry should cover only patterns already needed by the current Odoo slice:

1. Manifest lifecycle hooks such as `post_init_hook`.
2. XML object buttons.
3. Simple server-action method calls already recognized today.
4. `_name` and `_inherit` model declarations where appropriate for structural linking.
5. `self.env['model'].method(...)` and `env['model'].method(...)` direct model calls.
6. `super().method(...)` recognition remains context-dependent but its recognition trigger can come from the registry.

Existing model/field extraction that is already stable does not have to be rewritten merely to satisfy the registry design. The goal is to move repeated recognizers first, not refactor unrelated code.

## Adapter responsibilities

The Odoo adapter remains responsible for:

- deciding which files belong to detected Odoo addons
- reading those files
- applying matching registry rules
- adding source/addon/model context
- mapping captures into existing canonical topology entities/functions/fields/relationships
- handing executable seeds to framework expansion
- reporting unresolved or ambiguous evidence instead of guessing

The adapter must not contain one-off branches for every new regex-recognizable Odoo convention.

## What stays in code

Code is still appropriate where meaning depends on state accumulated across matches or on existing topology context, for example:

- variable binding across multiple Python statements
- resolving the current model for `super()`
- inheritance/model composition
- dynamic model names
- locating the framework implementation of a captured model/method

These are resolvers, not recognition patterns. Do not generalize them until real repositories demonstrate the need.

## Canonical output

Registry matches must feed the same canonical structural topology used elsewhere in LeMap. The rest of LeMap should not need to know which regex produced the evidence.

Examples:

```text
entrypoint → triggers → function
function → calls → function
entity → extends → entity
entity → has field → field
function → reads/writes → entity
```

Every emitted fact should retain provenance to rule id, source path, line where available, addon, and captured text/value.

## Non-goals

This slice will not:

- build a generic AST or parser framework
- build a custom DSL for patterns
- solve arbitrary Python dataflow
- make dynamic Odoo calls statically certain
- change CallPathIndexer
- change Pass 1 or Pass 2
- add runtime instrumentation
- add patterns merely because they might exist in Odoo; add them when useful to current or observed repos

## Acceptance criteria

1. Current manifest-hook recognition is represented by registry configuration rather than a dedicated regex inside adapter code.
2. Existing XML object-button recognition can be driven through the registry without losing current behavior.
3. Direct `env` / `self.env` model-method recognition can be expressed by registry rules and still seed framework expansion.
4. Rules can be added to the JSON registry without changing the generic pattern application loop.
5. Matching remains tolerant enough to handle ordinary whitespace, quote, and multiline formatting variants covered by tests.
6. The ACME assessment still reaches the same or better structural evidence after the refactor.
7. CallPathIndexer and semantic stages remain unchanged.
