import { listRepo, prepareRepo, readRepoFile, searchRepo } from './repoTools.js';
import { semanticStore } from './store.js';

export const modelTools = [
  {
    type: 'function', name: 'repo_prepare',
    description: 'Clone and prepare the submitted Git repository for exploration.',
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
    description: 'Record an evidence-backed end-to-end business workflow discovered in the repository.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'name', 'description', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_node',
    description: 'Record or enrich a semantic-map node. Use business_concept, workflow, persistent_data, service, or condition as kind.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }, label: { type: 'string' },
        kind: { type: 'string', enum: ['business_concept', 'workflow', 'persistent_data', 'service', 'condition'] },
        description: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'label', 'kind', 'description', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_relation',
    description: 'Record an evidence-backed relation between two semantic-map nodes.',
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
    description: 'Record a persistent entity/table encountered through a database/entity read or write. Do not use this for transient variables or in-memory objects.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }, label: { type: 'string' }, store: { type: 'string' },
        operation: { type: 'string', enum: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'READ_WRITE'] },
        fields: { type: 'array', items: { type: 'string' } }, workflowId: { type: 'string' },
        evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'label', 'store', 'operation', 'fields', 'workflowId', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_condition',
    description: 'Record a branch or configuration/data condition that changes a business workflow path.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' }, label: { type: 'string' }, expression: { type: 'string' },
        driver: { type: 'string', enum: ['config', 'data', 'runtime', 'unknown'] },
        truePath: { type: 'string' }, falsePath: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }
      },
      required: ['id', 'label', 'expression', 'driver', 'truePath', 'falsePath', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_complete',
    description: 'Finish discovery after multiple major workflows, persistent datasets, and important conditions are represented.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false }
  }
];

export async function executeTool(name, args) {
  switch (name) {
    case 'repo_prepare': return prepareRepo(args.repoUrl);
    case 'repo_list': return listRepo(args.path);
    case 'repo_search': return searchRepo(args.query, args.maxResults);
    case 'repo_read_file': return readRepoFile(args.path, args.startLine, args.endLine);
    case 'semantic_record_workflow': return semanticStore.addWorkflow(args);
    case 'semantic_record_node': return semanticStore.upsertNode(args);
    case 'semantic_record_relation': return semanticStore.upsertEdge(args);
    case 'semantic_record_persistent_data': {
      semanticStore.upsertNode({ id: args.id, label: args.label, kind: 'persistent_data', description: `${args.operation} in ${args.workflowId}`, evidence: args.evidence });
      return semanticStore.addPersistentData(args);
    }
    case 'semantic_record_condition': {
      semanticStore.upsertNode({ id: args.id, label: args.label, kind: 'condition', description: args.expression, evidence: args.evidence });
      return semanticStore.addCondition(args);
    }
    case 'semantic_complete': return semanticStore.complete(args.summary);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
