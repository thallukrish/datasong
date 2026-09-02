import { selectSemanticPaths } from './pathSelector.js';
import { PASS1_SYSTEM, buildPass1Prompt, normalizePass1Response } from './pass1.js';
import { PASS2_SYSTEM, buildPass2Prompt, normalizePass2Response } from './pass2.js';
import { materializeSemanticGraph } from './semanticGraph.js';
import { callJsonModel } from './modelCall.js';

export async function learnSemanticPath({
  client,
  model,
  workflowGraph,
  entities = {},
  path = null,
  annotatedPathIds = []
} = {}) {
  const selectedPath = path || selectSemanticPaths(workflowGraph, { limit: 1, annotatedPathIds })[0];
  if (!selectedPath) throw new Error('No structural workflow path is available for semantic learning');

  const pass1Call = await callJsonModel({
    client,
    model,
    systemPrompt: PASS1_SYSTEM,
    userPrompt: buildPass1Prompt({ workflowPath: selectedPath, workflowGraph, entities })
  });
  const pass1 = normalizePass1Response(pass1Call.parsed);

  const pass2Call = await callJsonModel({
    client,
    model,
    systemPrompt: PASS2_SYSTEM,
    userPrompt: buildPass2Prompt({ pass1, workflowPath: selectedPath, workflowGraph, entities })
  });
  const pass2 = normalizePass2Response(pass2Call.parsed);
  const semanticGraph = materializeSemanticGraph({ pass1, pass2 });

  return {
    path: selectedPath,
    pass1,
    pass2,
    semanticGraph,
    usage: {
      pass1: pass1Call.usage,
      pass2: pass2Call.usage
    }
  };
}
