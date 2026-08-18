import { ProgressiveRepositoryExplorerV7 } from './progressiveRepositoryExplorerV7.js';

const BUSINESS_FLOW_OBJECTIVE = `PRIMARY EXPLORATION OBJECTIVE\nDiscover end-to-end vertical slices of BUSINESS USE CASES implemented by the enterprise application.\n\nThink from the perspective of an end user or business actor: what are they trying to accomplish, and how does the system support that intent end to end?\n\nIllustrative examples only (not a closed ontology):\n- customer searches for a product\n- customer adds items to a cart\n- customer places an order\n- customer updates contact information\n- employee approves a request\n- operator schedules a shipment\n- an external business system submits an order\n- a scheduled business process creates invoices\n\nRepository artifacts are EVIDENCE, not the objective. Tests, test suites, setup/cleanup code, framework wiring, configuration, utilities, shared services, logs and infrastructure can be highly valuable because they reveal or connect parts of a business use case. Follow them when they help discover or explain an end-to-end business flow.\n\nDo NOT create a durable business thread merely because implementation artifacts form a technically coherent sequence. A durable thread should represent a business capability/use case from the perspective of an end user or business actor.\n\nThe end user need not literally be a human UI user. A business actor may also be an external system, scheduler, batch process, operator or other participant when the vertical slice corresponds to a genuine enterprise/business capability rather than implementation plumbing.`;

const ORIENTATION_OBJECTIVE = `REPOSITORY ORIENTATION OBJECTIVE\nNavigate toward evidence likely to reveal end-to-end business use cases supported by the application.\nTests and test suites may be excellent maps of user-visible scenarios, but do not treat test harness/setup/cleanup as the business use case itself. Prefer artifacts likely to expose user/business intents such as search, cart, checkout, order, profile update, approval, fulfillment, billing, scheduling or analogous domain behaviors. These examples are illustrative only.`;

export class ProgressiveRepositoryExplorerV8 extends ProgressiveRepositoryExplorerV7 {
  buildPrompt(observation, candidates) {
    const base = super.buildPrompt(observation, candidates);

    if (observation?.kind === 'repo_directory' || observation?.kind === 'source_file_index') {
      return `${base}\n\n${ORIENTATION_OBJECTIVE}`;
    }

    if (observation?.kind === 'semantic_neighborhood') {
      return `${BUSINESS_FLOW_OBJECTIVE}\n\n${base}\n\nSCORING OBJECTIVE ALIGNMENT\n- CONTINUITY means: how naturally this candidate continues our understanding of the SAME end-user/business use case.\n- COHERENCE means: how strongly this candidate belongs to the SAME end-to-end business use case, not merely the same technical subsystem.\n- EXPECTED GAIN means: how likely inspection is to reveal a missing business stage, decision, data effect, outcome, branch or actor interaction in that use case.\n- Technical adjacency, setup/cleanup, framework lifecycle and shared helpers may score high only when they materially advance understanding of the business use case.`;
    }

    if (['semantic_function', 'xml_file', 'config_file', 'text_file'].includes(observation?.kind)) {
      return `${BUSINESS_FLOW_OBJECTIVE}\n\n${base}\n\nTHREAD CREATION RULE\nBefore creating or promoting a durable thread, ask: can this narrative be stated as a business capability or end-user/business-actor use case? If not, keep it as supporting evidence/proto orientation rather than crystallizing a durable business thread.\nTechnical artifacts may belong inside a business thread when they explain how that use case is implemented, but technical coherence alone is insufficient.`;
    }

    return base;
  }
}
