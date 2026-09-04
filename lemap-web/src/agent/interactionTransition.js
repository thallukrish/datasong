import { recordSelectedTransition } from './memory.js';

export function recordInteractionWorkflowTransition(memory, {
  session = null,
  sourceEntityId = '',
  targetEntityId = '',
  interaction = {},
  behavior = null
} = {}) {
  if (!memory || !sourceEntityId || !targetEntityId || !interaction?.semanticKey || !behavior?.classId) return null;
  const candidate = {
    id: `interaction:${interaction.semanticKey}:${behavior.classId}`,
    label: interaction.semanticName || interaction.semanticKey,
    kind: 'interaction',
    href: ''
  };
  const score = {
    role: 'workflow_branch',
    goalRelevance: Number(interaction.goalRelevance || 0.5),
    continuity: 1,
    forwardProgress: 1
  };
  return recordSelectedTransition(memory, {
    sourceEntityId,
    targetEntityId,
    candidate,
    score,
    alternatives: [],
    session
  });
}
