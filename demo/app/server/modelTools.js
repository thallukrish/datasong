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
    description: 'Record or enrich the current business workflow using a plain-English name and story. Reuse a known canonical id when the workflow already exists. Keep implementation names in technicalNames/evidence.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string', description: 'Plain-English business name, e.g. Customer places an order.' },
        description: { type: 'string', description: 'Short human-readable explanation of what happens in the business.' },
        technicalNames: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'name', 'description', 'technicalNames', 'evidence'], additionalProperties: false
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
    description: 'Record or enrich durable business data encountered through a database/entity read or write. Give it a human businessLabel and preserve the exact entity/table in technicalName.',
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
    description: 'Record or enrich a business rule or decision point that changes the current workflow path. The visible label must be understandable without seeing code.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        label: { type: 'string', description: 'Plain-English question such as Inventory required?' },
        expression: { type: 'string', description: 'Technical expression/config behind the decision.' },
        driver: { type: 'string', enum: ['config', 'data', 'runtime', 'unknown'] },
        truePath: { type: 'string' }, falsePath: { type: 'string' },
        technicalNames: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'label', 'expression', 'driver', 'truePath', 'falsePath', 'technicalNames', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_complete',
    description: 'Finish only after the current business story is connected end-to-end and its important persistent data and branch conditions are attached to that story.',
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
        technicalNames: args.technicalNames,
        evidence: args.evidence
      });
      return semanticStore.addWorkflow(args);
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
      return semanticStore.addPersistentData(args);
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
      return semanticStore.addCondition(args);
    }
    case 'semantic_complete': return semanticStore.complete(args.summary);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
