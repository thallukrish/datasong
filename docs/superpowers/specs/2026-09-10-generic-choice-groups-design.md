# Generic Choice Groups Design

## Goal
Represent one user-facing choice as a single structural `group` regardless of whether its members are radios, checkboxes, buttons, chips/cards exposed as button-like controls, or other peer choice controls.

## Structural model
A choice group has:
- stable `id` derived from page/entity context plus shared question/container identity
- `label` containing the user-facing question/context
- `groupType: "choice"`
- `cardinality`: `exactlyOne`, `zeroOrMore`, or `oneOrMore`
- `memberFieldIds`

Member controls remain concrete `ui_control` entities and retain their browser execution evidence (`domId`, `name`, role/tag, value, label). Members are linked `partOf` the group and are not independently sent for semantic enrichment.

## Detection
Grouping is context-first, not widget-first. Controls sharing the same meaningful parent question/context are candidates. Radio peers with a common name remain strong evidence for an `exactlyOne` group; checkboxes produce a multi-select group; answer-like button peers under the same question/context produce `exactlyOne` groups. Navigation/action controls such as Continue, Back, Submit, Save, Cancel and similar commands are excluded from answer-button groups.

## Semantics and prompting
Only the group is interpreted as the user-facing interaction. Structural member labels become `choices`; the model supplies business meaning/question/explanation only. The prompt displays the group's question and structural choices.

## Execution
An answer is resolved locally to a member entity by label/value. The concrete member control adapter then performs the interaction (check radio/checkbox, click button-like control, etc.).

## Constraints
- Invisible controls are never captured or sent to the model.
- Existing radio/checkbox behavior must remain compatible.
- No model call is needed to decide member grouping or answer-to-member mapping.
- Do not special-case the income-tax portal.
