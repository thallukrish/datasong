import { listRepo, prepareRepo, readRepoFile, searchRepo } from './repoTools.js';
import { semanticStore } from './store.js';

export const modelTools = [
  {
    type: 'function', name: 'repo_prepare',
    description: 'Clone and prepare the submitted Git repository. Returns commit/tree change assessment and a workflow work plan.',
    parameters: { type: 'object', properties: { repoUrl: { type: 'string' } }, required: ['repoUrl'], additionalProperties: false }
  },
  {
    type: 'function', name: 'repo_list',
    description: 'List files and directories under a repository path.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false }
  },
  {
    type: 'function', name: 'repo_search',
    description: 'Search repository text for evidence needed by the CURRENT workflow only.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'integer' } }, required: ['query', 'maxResults'], additionalProperties: false }
  },
  {
    type: 'function', name: 'repo_read_file',
    description: 'Read a bounded line range from a repository file relevant to the CURRENT workflow.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, required: ['path', 'startLine', 'endLine'], additionalProperties: false }
  },
  {
    type: 'function', name: 'semantic_record_workflow',
    description: 'Record or enrich one complete end-to-end enterprise use case. It must have a business trigger, outcome, immediate concepts, governing rules and optional next workflows.',
    parameters: {
      type: 'object', properties: {
        id: { type: 'string' }, name: { type: 'string' }, trigger: { type: 'string' }, outcome: { type: 'string' }, description: { type: 'string' },
        conceptIds: { type: 'array', items: { type: 'string' } }, ruleIds: { type: 'array', items: { type: 'string' } }, nextWorkflowIds: { type: 'array', items: { type: 'string' } },
        technicalNames: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'string' } }
      }, required: ['id', 'name', 'trigger', 'outcome', 'description', 'conceptIds', 'ruleIds', 'nextWorkflowIds', 'technicalNames', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_node',
    description: 'Record or enrich a canonical business concept used by the CURRENT workflow. Visible label must be plain business language.',
    parameters: {
      type: 'object', properties: {
        id: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string', enum: ['business_concept', 'workflow', 'persistent_data', 'service', 'condition'] },
        description: { type: 'string' }, technicalNames: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'string' } }
      }, required: ['id', 'label', 'kind', 'description', 'technicalNames', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_relation',
    description: 'Connect two business-story objects in the CURRENT workflow.',
    parameters: {
      type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' }, relation: { type: 'string' }, confidence: { type: 'number' }, evidence: { type: 'array', items: { type: 'string' } } },
      required: ['source', 'target', 'relation', 'confidence', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_persistent_data',
    description: 'Record durable business data proven by a database/entity read or write and attach it to the CURRENT workflow.',
    parameters: {
      type: 'object', properties: {
        id: { type: 'string' }, businessLabel: { type: 'string' }, technicalName: { type: 'string' }, store: { type: 'string' },
        operation: { type: 'string', enum: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'READ_WRITE'] }, fields: { type: 'array', items: { type: 'string' } }, workflowId: { type: 'string' },
        description: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } }
      }, required: ['id', 'businessLabel', 'technicalName', 'store', 'operation', 'fields', 'workflowId', 'description', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_record_condition',
    description: 'Record a business rule that changes the CURRENT workflow path and attach it to that workflow.',
    parameters: {
      type: 'object', properties: {
        id: { type: 'string' }, workflowId: { type: 'string' }, label: { type: 'string' }, expression: { type: 'string' }, driver: { type: 'string', enum: ['config', 'data', 'runtime', 'unknown'] },
        truePath: { type: 'string' }, falsePath: { type: 'string' }, technicalNames: { type: 'array', items: { type: 'string' } }, evidence: { type: 'array', items: { type: 'string' } }
      }, required: ['id', 'workflowId', 'label', 'expression', 'driver', 'truePath', 'falsePath', 'technicalNames', 'evidence'], additionalProperties: false
    }
  },
  {
    type: 'function', name: 'semantic_finish_workflow',
    description: 'Mark the CURRENT workflow task complete only after its end-to-end workflow, immediate concepts, rules, persistent data and important relationships have been recorded.',
    parameters: { type: 'object', properties: { workflowId: { type: 'string' }, summary: { type: 'string' } }, required: ['workflowId', 'summary'], additionalProperties: false }
  },
  {
    type: 'function', name: 'semantic_complete',
    description: 'Internal global completion tool. The orchestrator normally completes the run after all planned workflow tasks finish.',
    parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'], additionalProperties: false }
  }
];

export async function executeTool(name, args) {
  switch (name) {
    case 'repo_prepare': {
      const previousCommit = semanticStore.previousCommitFor(args.repoUrl);
      const repo = await prepareRepo(args.repoUrl, previousCommit);
      const knowledgeReuse = semanticStore.setScanContext(repo);
      const workflowPlan = semanticStore.buildWorkflowPlan(repo, knowledgeReuse);
      return { ...repo, knowledgeReuse, workflowPlan };
    }
    case 'repo_list': return listRepo(args.path);
    case 'repo_search': return searchRepo(args.query, args.maxResults);
    case 'repo_read_file': return readRepoFile(args.path, args.startLine, args.endLine);
    case 'semantic_record_workflow': {
      semanticStore.upsertNode({ id: args.id, label: args.name, kind: 'workflow', description: args.description, trigger: args.trigger, outcome: args.outcome, technicalNames: args.technicalNames, evidence: args.evidence });
      const event = semanticStore.addWorkflow(args);
      for (const conceptId of args.conceptIds || []) semanticStore.upsertEdge({ source: args.id, target: conceptId, relation: 'involves', confidence: 1, evidence: args.evidence });
      for (const ruleId of args.ruleIds || []) semanticStore.upsertEdge({ source: args.id, target: ruleId, relation: 'governed by', confidence: 1, evidence: args.evidence });
      for (const nextWorkflowId of args.nextWorkflowIds || []) semanticStore.upsertEdge({ source: args.id, target: nextWorkflowId, relation: 'may trigger', confidence: 0.9, evidence: args.evidence });
      return event;
    }
    case 'semantic_record_node': return semanticStore.upsertNode(args);
    case 'semantic_record_relation': return semanticStore.upsertEdge(args);
    case 'semantic_record_persistent_data': {
      semanticStore.upsertNode({ id: args.id, label: args.businessLabel, kind: 'persistent_data', description: args.description, technicalNames: [args.technicalName], evidence: args.evidence });
      const event = semanticStore.addPersistentData(args);
      semanticStore.upsertEdge({ source: args.workflowId, target: args.id, relation: 'uses data', confidence: 1, evidence: args.evidence });
      return event;
    }
    case 'semantic_record_condition': {
      semanticStore.upsertNode({ id: args.id, label: args.label, kind: 'condition', description: `${args.label} ${args.truePath} / ${args.falsePath}`, technicalNames: args.technicalNames, evidence: args.evidence });
      const event = semanticStore.addCondition(args);
      semanticStore.upsertEdge({ source: args.workflowId, target: args.id, relation: 'governed by', confidence: 1, evidence: args.evidence });
      return event;
    }
    case 'semantic_finish_workflow': return semanticStore.finishWorkflowTask(args.workflowId, args.summary);
    case 'semantic_complete': return semanticStore.complete(args.summary);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
