# LeMap-Web Domain-Neutral Core

LeMap-Web core must not encode business-domain vocabulary or domain-specific workflow rules.

## Invariant

If a rule can only be explained using a particular application's business vocabulary, it does not belong in core code.

Core owns only browser/workflow mechanics:
- structural entities, fields, groups, actions, and state
- application-global vs local entity scope
- semantic interaction identity and reusable wording
- generic value reuse scope
- execution traces and behavior classes
- goal-directed navigation
- generic action consequence classification

The learned semantic map owns business vocabulary such as assessment year, filing mode, account type, shipment method, insurance product, etc.

## Generic value scopes

Interaction `valueScope` is limited to:
- `application`: reusable throughout the application
- `actor`: reusable for the configured actor/principal
- `workflow`: reusable for the same user-goal/workflow key
- `workflow_instance`: only reusable within the current execution instance

Core derives the workflow key generically from the normalized user goal. It does not parse domain-specific goal syntax.

## Generic navigation consequence

The navigation semantic model classifies every candidate as one of:
- `reversible`: ordinary navigation or reversible workflow progress
- `commit`: consequential external commit/submission
- `financial`: payment or financial commitment
- `destructive`: delete/remove/destructive mutation
- `security`: authentication/security-sensitive action
- `unknown`

Only `reversible` candidates may be auto-executed. No domain-specific button-label blacklist is used.

## Compatibility

Persisted semantic/instance memory using obsolete domain-specific scope names is not authoritative core schema. New learning writes only the generic scope vocabulary. Existing semantic entities may be relearned naturally when their interaction schema is incompatible.
