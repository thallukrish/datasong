import { ProgressiveRepositoryExplorer } from './progressiveRepositoryExplorer.js';

export class ProgressiveRepositoryExplorerV2 extends ProgressiveRepositoryExplorer {
  // ModelDirectedExplorer's semantic-response validator calls this method
  // dynamically. Override it so progressive browsing operations remain valid
  // after we have entered function-level semantic traversal.
  validateRequest(request, candidates, neighborhood = false) {
    return this.validateBrowseRequest(request, null, candidates, neighborhood);
  }

  buildPrompt(observation, candidates) {
    if (observation?.kind !== 'repo_directory') return super.buildPrompt(observation, candidates);

    const contract = {
      evidenceRequest: {
        type: 'listDirectory|getArtifact|searchSemantic|stop',
        artifactId: 'exact file/directory id when getArtifact',
        path: 'directory path when listDirectory; may be a deeper path shown in a directory preview',
        query: 'semantic question for searchSemantic',
        reason: 'why this evidence is promising'
      }
    };

    return `MODE: REPOSITORY ORIENTATION\n\nDIRECTORY\n${JSON.stringify(observation.canonical || {})}\n\nRETURN CONTRACT\n${JSON.stringify(contract)}\n\nRules:\n- Choose what to inspect based on likely semantic information gain.\n- Directory previews are deterministic structural metadata: descendant file counts, extensions, sample paths and shallow subtrees. They are not semantic rankings.\n- You may jump directly with listDirectory to a deeper directory path that appears in a preview; do not spend separate calls descending a single obvious directory chain.\n- Use getArtifact for a file.\n- Do not infer a business flow merely from a file or directory name.\n- Prefer evidence-rich areas only because their structural preview gives you more reason to inspect them, not because DataSong has assigned them semantic importance.\n- Copy ids/paths exactly from the listing or preview.`;
  }
}
