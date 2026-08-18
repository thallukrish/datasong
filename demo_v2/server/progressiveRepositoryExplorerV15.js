import { ProgressiveRepositoryExplorerV14 } from './progressiveRepositoryExplorerV14.js';

const XML_HIERARCHY_POLICY = `PASS-1 XML/JMX HIERARCHY POLICY
XML/JMX files are exposed lazily as hierarchy, not as whole-document text.
- A file observation contains the document root/top-level structure and immediate children only.
- An xmlnode:* candidate is an addressable hierarchy node. Use getArtifact on that exact id to reveal only that node and its immediate children.
- Descend only when a child is likely to reveal a major business stage, decision, data effect, actor interaction, persistence/external handoff, or important entity relationship.
- Do not ask for the whole XML document; it is intentionally not transported in Pass 1.
- If the current level already establishes the broad business meaning, continue the arc/search/backtrack rather than drilling for implementation completeness.`;

export class ProgressiveRepositoryExplorerV15 extends ProgressiveRepositoryExplorerV14 {
  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);
    if (observation?.kind !== 'xml_file') return base;
    return `${base}\n\n${XML_HIERARCHY_POLICY}`;
  }
}
