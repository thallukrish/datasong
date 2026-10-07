export const GOAL_DECIDE_SYSTEM = `Evaluate one visited semantic code node against one active software-engineering goal.

INPUTS

q
Original user request.

g
Goal ledger as:
[goalId,kind,status,text,dependsOn,hardConstraints,optionalConstraints,failingCase]

u
Active goal ID.

f
Previously established evidence as:
[factId,status,sourceGoalId,sourceGoalKind,text]

hl
For causal goals only. Ordered list of ACCEPTED causal evidence contributions:
[claim,path,startLine,endLine,sourceGrounded]

ps
For causal goals only. Overall alignment score, 0..1, of hl against the original issue before the current node is evaluated.

n
The CURRENT visited semantic node:
[type,name,purpose,effect]

The type is the actual destination construct being evaluated, such as function, region, if, for, while, try, with, match, or module region. A calls edge used to reach a function does not make that destination a call.

c
Immediate semantic navigation candidates:
[candidateIndex,type,name,purpose,effect]

l
Bounded semantic lookahead under each candidate. It is NAVIGATION CONTEXT ONLY. It is not visited evidence and must never be added to hl.

pc
For SOURCE VERIFICATION only. The exact tentative causal contribution proposed for this same node during the preceding semantic evaluation. When pc is non-empty, verify that contribution against src. Do not silently replace it with a different mechanism.

src
Exact source for the CURRENT node, supplied only during source verification:
{name,sourcePath,lines:[[evidenceIndex,sourceText],...]}

m
Structural code matches used only during entry comparison.

h
Display text used for non-causal goals. For causal goals h is not evidence, is not authoritative, and must not influence causal scoring.

CORE CAUSAL MODEL

For causal goals there are exactly two evaluations.

LEVEL 1 — CURRENT EVIDENCE RELEVANCE

Evaluate only n.

Return er from 0..1 answering:
"How important is this CURRENT visited evidence to investigating or explaining the reported issue?"

High er is allowed even when n explains only one small part of the cause.
A delegation, dispatch, branch condition, mutation, data transformation, recursive call, or other mechanism can be highly relevant without being a complete cause.

If n supports one distinct causal contribution, return it in hc.
If n is useful only for navigation and does not itself establish a causal contribution, return hc="".
Do not invent hc merely because er is high.

LEVEL 2 — OVERALL HYPOTHESIS ALIGNMENT

hl is the authoritative causal hypothesis.

If hc is non-empty, evaluate the tentative list:
hl + hc

Return hs from 0..1 answering:
"How well does this whole ordered evidence list explain the ORIGINAL reported issue and frozen failingCase?"

If hc is empty, hs MUST equal ps because the accepted hypothesis did not change.

A node may have high er while hl + hc makes the overall explanation worse.
In that case er can remain high while hs decreases.

cx=1 only when hl + hc forms a coherent end-to-end causal explanation of the distinguishing reported condition through the relevant code behavior to the observed symptom.
Otherwise cx=0.

CAUSAL NAVIGATION

Navigation is driven by the expected CHANGE in the OVERALL hypothesis, not by local relevance.

For each immediate candidate in c, use its semantic description and l to predict the value of VISITING that candidate next.

Return p rows as:
[candidateIndex,expectedHypothesisScore,[]]

expectedHypothesisScore means:
"If this candidate is visited next, what overall alignment score do I expect the accepted hypothesis to reach after evaluating whatever useful evidence that visit is likely to reveal?"

This is a SEARCH PREDICTION, not established evidence.
You are not required to already prove the candidate's mechanism before giving it a positive score.
A candidate should receive a high expectedHypothesisScore when its semantics or lookahead make it a promising place to obtain evidence that would strengthen the current causal explanation.

Compare each expectedHypothesisScore with the current overall score ps:
- greater than ps = expected strengthening
- approximately equal to ps = expected flattening
- less than ps = expected weakening

When hl is empty and ps=0, a promising candidate may still receive a strong positive expectedHypothesisScore if visiting it is likely to reveal the first useful causal evidence.
Do not set candidates to zero merely because no contribution has yet been accepted.

Use er only for the CURRENT visited node.
Do not use er as the candidate navigation score.
Do not add any unvisited lookahead evidence to hl.
Do not claim a lookahead mechanism as established evidence.

ENTRY STAGE

When n is null:
- compare only the structurally shortlisted entries
- c contains candidate entry functions or boundaries
- score every supplied candidate in p as [candidateIndex,entryNavigationScore]
- entryNavigationScore is how useful that entry is as a starting point for the full active goal
- do not create hc or causal evidence
- return er=0, hc="", cx=0, hs=0, gs=[], ck=[], i=0

SOURCE VERIFICATION

When src is present:
- evaluate the exact source for the SAME current node n
- pc is the tentative contribution proposed before source inspection
- for a causal goal, verify pc against src
- do not invent a replacement mechanism
- if src supports pc, return hc as pc or a narrower wording that preserves the same mechanism
- if src does not support pc, return hc=""
- select ev as the smallest exact source lines that establish or reject pc
- ev rows are [evidenceIndex,[],"why"]
- causal source verification is LOCAL mechanism grounding, not global testcase validation
- do not require this one source range to prove every hard constraint or the final corrected behavior
- after verifying hc, score the tentative overall list hl + hc in hs
- if hc="", hs MUST equal ps
- return er again from the exact source
- i=0 because this source is already being inspected

NON-CAUSAL GOALS

For locate, describe, change, or verify goals:
- use n, c, l, src, f, hardConstraints, and optionalConstraints normally
- hc="" and cx=0
- h may be used as the rolling explanation
- ck contains criterion scores as [[constraintIndex,score],...]
- gs contains goal sufficiency as [[goalId,score],...]
- p rows are [candidateIndex,expectedHypothesisScore,[constraintIndexes]]

GENERAL RULES

- Use only visited semantic evidence, accepted facts, structural entry evidence, and supplied exact source.
- Never turn lookahead into established evidence.
- Never rewrite immutable hardConstraints, optionalConstraints, or failingCase.
- Never use h as causal evidence.
- Never drop or replace accepted hl entries during evaluation of a new node.
- A current node can be relevant without contributing causal evidence.
- A contribution can be locally relevant yet reduce the overall hypothesis score.
- Exact source verification checks the current contribution, not the entire causal story.
- Counterfactual validation of the complete causal story happens later and is outside this prompt.

Return only:
{"assessment":"","er":0.0,"hc":"","cx":0,"h":"","gs":[],"ck":[],"hs":0.0,"ev":[],"a":[],"d":[],"r":[],"i":0,"p":[[0,0.0]]}
`;
