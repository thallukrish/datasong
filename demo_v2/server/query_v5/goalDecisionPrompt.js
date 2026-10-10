export const CAUSAL_DECIDE_SYSTEM = `Evaluate one visited semantic code node for a causal software-engineering issue.

INPUT

q
Original issue text.

g
Active causal goal only:
[goalText,failingCase]

hl
CURRENT causal explanatory set for THIS entry branch.
Each item is:
[claim,structuralSupport]

structuralSupport is:
{"entities":[[operation,name,description],...],"flows":[[workflowName,position,functionCount,description],...]}

The array index is the evidence index used by k below.
These entity operations and flow memberships are deterministic structural provenance already attached to that claim. Treat them as evidence constraining the meaning of the claim. Do not invent, remove, reverse, or reinterpret them.
hl is not a permanent history. Earlier evidence may be dropped when newer visited evidence makes it unnecessary.

ps
Current overall score, 0..1, of hl against q and failingCase.

n
CURRENT visited semantic node:
[type,name,purpose,effect,lineage]

lineage is optional compact deterministic structural context:
{"entities":[[operation,name,description],...],"flows":[[workflowName,position,functionCount,description],...]}
Entity operations and flow membership come from static structure. Treat them as constraints on interpretation, not as extra inferred evidence. Use them only when they materially clarify the current node.

c
Immediate unvisited candidates:
[candidateIndex,type,name,purpose,effect,lineage]

l
Bounded descendant semantics for candidates, used only to predict where useful evidence may be found.
Lookahead is not visited evidence.

TASK

1. Decide whether n contributes one concrete causal fact.
- er=1 only when n itself establishes a useful causal fact.
- er=0 otherwise.
- If er=1, hc must be one minimal NEW fact established by n.
- If that local fact is already represented in hl, return er=0 and hc="".
- hc must not include an inferred root cause, downstream behavior, or facts from lookahead.
- If er=0, hc="".
- n.lineage may contain deterministic entity and workflow evidence for the current node.
- If hc materially depends on one or more current entity lineage items, return their zero-based indexes in es.
- If hc materially depends on one or more current flow lineage items, return their zero-based indexes in ws.
- Do not select lineage merely because it is present. es/ws must contain only lineage needed to support hc.
- If er=0 or hc="", return es=[] and ws=[].

2. Revise and score the causal explanation.
- Return k as the indexes of the OLD hl items that still materially contribute to the best causal explanation after considering n.
- k must contain only valid hl indexes, without duplicates. Keep their original order.
- You may drop old hl items that were useful earlier but no longer contribute to the causal explanation.
- You may not invent replacements for dropped items. The revised set is ONLY retained old hl items plus the optional current hc.
- Choose the smallest retained set that preserves the strongest explanation.
- hs scores exactly: retained hl[k] + hc, including the deterministic structuralSupport attached to each retained claim and the selected es/ws support for hc, against the ORIGINAL issue q and failingCase.
- If hc="" you may still revise hl by dropping unnecessary old items, so hs need not equal ps.
- Do not return a revised set with materially lower explanatory strength merely to make it shorter.
- cx=1 only when retained hl[k] + hc is a coherent end-to-end explanation of the reported failure. Otherwise cx=0.

3. Predict navigation.
For every candidate in c return:
[candidateIndex,expectedHypothesisScore,[]]

expectedHypothesisScore is the score you expect the accepted hypothesis to reach AFTER that candidate is actually visited and any useful local contribution from it is evaluated.
It is a search prediction only.
A promising unvisited candidate can score above ps even when hl is empty.
Never add lookahead content to hl and never state lookahead as established evidence.

Return only:
{"k":[],"er":0,"hc":"","es":[],"ws":[],"hs":0.0,"cx":0,"p":[]}
`;

export const GOAL_DECIDE_SYSTEM = `Evaluate one visited semantic code node against one active NON-CAUSAL software-engineering goal.

INPUT

q
Original request.

g
Goal ledger:
[goalId,kind,status,text,dependsOn,hardConstraints,optionalConstraints,failingCase]

u
Active goal ID.

f
Previously established evidence:
[factId,status,sourceGoalId,sourceGoalKind,text]

h
Current evidence-backed explanation for the active goal.

n
CURRENT visited semantic node:
[type,name,purpose,effect,lineage]
n is null only for entry comparison.

lineage is optional compact deterministic structural context:
{"entities":[[operation,name,description],...],"flows":[[workflowName,position,functionCount,description],...]}
Entity operations and flow membership come from static structure. Treat them as constraints on interpretation. Do not invent entity transformations or flow membership beyond lineage.

c
Immediate candidates:
[candidateIndex,type,name,purpose,effect,lineage]

l
Bounded semantic lookahead for navigation only.

src
Exact source for the CURRENT node when source inspection is active:
{name,sourcePath,lines:[[evidenceIndex,sourceText],...]}

m
Structural matches used only when n is null.

TASK

When n is null, rank supplied entries in p and do not form a hypothesis.

Otherwise:
- update h only from visited evidence
- score fixed acceptance criteria in ck as [[constraintIndex,score],...]
- score goal sufficiency in gs as [[goalId,score],...]
- use p to rank immediate candidates as [candidateIndex,expectedHypothesisScore,[constraintIndexes]]
- use i=1 only when exact source is needed
- when src is present, select the smallest exact supporting lines in ev as [evidenceIndex,[constraintIndexes],"why"]
- never turn lookahead into established evidence

Return only:
{"assessment":"","h":"","gs":[],"ck":[],"hs":0.0,"ev":[],"a":[],"d":[],"r":[],"i":0,"p":[]}
`;
