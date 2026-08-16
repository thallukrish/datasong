import { listRepo, prepareRepo, readRepoFile, searchRepo } from './repoTools.js';
import { semanticStore } from './store.js';

export const modelTools = [
  {
    type: 'function', name: 'repo_prepare',
    description: 'Clone and prepare the submitted Git repository for exploration. Returns current commit, changed files since the last completed scan, and which saved semantic items can be reused versus rechecked.',
    parameters: { type: 'object', properties: { repoUrl: { type: 'string' } }, required: ['repoUrl'], additionalProperties: false }
  },
  {
    type: 'function', name: 'repo_list',
    description: 'List files and directories under a repository path.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
  },
  {
    type: 'function', name: 'repo_search',
    description: 'Search repository text for workflow names, service calls, entities, persistence operations, configuration conditions, or business terms.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'integer' } }, required: ['query', 'maxResults'], additionalProperties: false }
  },
  {
    type: 'function', name: 'repo_read_file',
    description: 'Read a bounded line range from a repository file.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } },
      required: ['path', 'startLine', 'endLine'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_workflow',
    description: 'Record or enrich one end-to-end enterprise story slice that accomplishes a concrete customer or business use case. A workflow has a clear trigger/start, a business outcome, immediate business concepts it acts on, governing rules, and optionally the next workflows it triggers. It is not merely a function, service, branch, or arbitrary code path.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', description: 'Plain-English end-to-end use case, e.g. Customer places an order.' },
        trigger: { type: 'string', description: 'What starts this business use case, in business language.' },
        outcome: { type: 'string', description: 'The business/customer outcome when this workflow completes.' },
        description: { type: 'string', description: 'Readable end-to-end explanation from trigger to outcome.' },
        conceptIds: { type: 'array', items: { type: 'string' }, description: 'Canonical business concepts immediately involved in this workflow.' },
        ruleIds: { type: 'array', items: { type: 'string' }, description: 'Business rules/conditions that directly govern this workflow.' },
        nextWorkflowIds: { type: 'array', items: { type: 'string' }, description: 'Known workflows this workflow directly triggers or hands off to. Use [] if not yet known.' },
        technicalNames: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'name', 'trigger', 'outcome', 'description', 'conceptIds', 'ruleIds', 'nextWorkflowIds', 'technicalNames', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_node',
    description: 'Record or enrich a business-story object. The visible label must be canonical plain English; implementation names belong in technicalNames.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { type: 'string', description: 'Human-readable business label such as Customer, Sales Order, Order Item, Product.' },
        kind: { type: 'string', enum: ['business_concept', 'workflow', 'persistent_data', 'service', 'condition'] },
        description: { type: 'string', description: 'What this means in the business, not a code description.' },
        technicalNames: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'label', 'kind', 'description', 'technicalNames', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_relation',
    description: 'Connect two already recorded story objects. Use a short business verb/phrase such as places, contains, refers to, checks, writes, or may block.',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string' }, target: { type: 'string' }, relation: { type: 'string' },
        confidence: { type: 'number' }, evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['source', 'target', 'relation', 'confidence', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_persistent_data',
    description: 'Record or enrich durable business data encountered through a database/entity read or write. Give it a human businessLabel and preserve the exact entity/table in technicalName. It must be attached to the workflow in which it is used.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        businessLabel: { type: 'string', description: 'Human label, e.g. Sales order record.' },
        technicalName: { type: 'string', description: 'Exact persistent entity/table name, e.g. mantle.order.OrderHeader.' },
        store: { type: 'string' },
        operation: { type: 'string', enum: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'READ_WRITE'] },
        fields: { type: 'array', items: { type: 'string' } }, workflowId: { type: 'string' },
        description: { type: 'string', description: 'Plain-English explanation of why this data matters in the current story.' },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'businessLabel', 'technicalName', 'store', 'operation', 'fields', 'workflowId', 'description', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_condition',
    description: 'Record or enrich a business rule or decision point that changes a workflow path. It must identify the workflow it governs.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        workflowId: { type: 'string', description: 'The end-to-end workflow directly governed by this rule.' },
        label: { type: 'string', description: 'Plain-English question such as Inventory required?' },
        expression: { type: 'string', description: 'Technical expression/config behind the decision.' },
        driver: { type: 'string', enum: ['config', 'data', 'runtime', 'unknown'] },
        truePath: { type: 'string' }, falsePath: { type: 'string' },
        technicalNames: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'workflowId', 'label', 'expression', 'driver', 'truePath', 'falsePath', 'technicalNames', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_complete',
    description: 'Finish only after every newly recorded workflow has a clear trigger/outcome and at least one immediate business connection, with important persistent data and branch conditions attached to the appropriate workflow.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false }
  }
];

export async function executeTool(name, args) {
  switch (name) {
    case 'repo_prepare': {
      const previousCommit = semanticStore.previousCommitFor(args.repoUrl);
      const repo = await prepareRepo(args.repoUrl, previousCommit);
      const knowledgeReuse = semanticStore.setScanContext(repo);
      return { ...repo, knowledgeReuse };
    }
    case 'repo_list': return listRepo(args.path);
    case 'repo_search': return searchRepo(args.query, args.maxResults);
    case 'repo_read_file': return readRepoFile(args.path, args.startLine, args.endLine);
    case 'semantic_record_workflow': {
      semanticStore.upsertNode({
        id: args.id,
        label: args.name,
        kind: 'workflow',
        description: args.description,
        trigger: args.trigger,
        outcome: args.outcome,
        technicalNames: args.technicalNames,
        evidence: args.evidence
      });
      const workflowEvent = semanticStore.addWorkflow(args);
      for (const conceptId of args.conceptIds || []) {
        semanticStore.upsertEdge({ source: args.id, target: conceptId, relation: 'involves', confidence: 1, evidence: args.evidence });
      }
      for (const ruleId of args.ruleIds || []) {
        semanticStore.upsertEdge({ source: args.id, target: ruleId, relation: 'governed by', confidence: 1, evidence: args.evidence });
      }
      for (const nextWorkflowId of args.nextWorkflowIds || []) {
        semanticStore.upsertEdge({ source: args.id, target: nextWorkflowId, relation: 'may trigger', confidence: 0.9, evidence: args.evidence });
      }
      return workflowEvent;
    }
    case 'semantic_record_node': return semanticStore.upsertNode(args);
    case 'semantic_record_relation': return semanticStore.upsertEdge(args);
    case 'semantic_record_persistent_data': {
      semanticStore.upsertNode({
        id: args.id,
        label: args.businessLabel,
        kind: 'persistent_data',
        description: args.description,
        technicalNames: [args.technicalName],
        evidence: args.evidence
      });
      const event = semanticStore.addPersistentData(args);
      semanticStore.upsertEdge({ source: args.workflowId, target: args.id, relation: 'uses data', confidence: 1, evidence: args.evidence });
      return event;
    }
    case 'semantic_record_condition': {
      semanticStore.upsertNode({
        id: args.id,
        label: args.label,
        kind: 'condition',
        description: `${args.label} ${args.truePath} / ${args.falsePath}`,
        technicalNames: args.technicalNames,
        evidence: args.evidence
      });
      const event = semanticStore.addCondition(args);
      semanticStore.upsertEdge({ source: args.workflowId, target: args.id, relation: 'governed by', confidence: 1, evidence: args.evidence });
      return event;
    }
    case 'semantic_complete': return semanticStore.complete(args.summary);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
