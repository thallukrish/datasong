import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveEntityGraphForEdge } from './entityGraph.js';
import { createInvestigationStore } from './investigationStore.js';
import { createCausalFragmentStore } from './fragmentStore.js';

test('entity graph is derived from matched workflow stages and relationships', () => {
  const workflows=[{
    id:'wf-1',
    workflowSteps:[
      {name:'MO',entities:['mrp.production']},
      {name:'Work order',entities:['mrp.workorder']}
    ],
    relationshipDetails:[{
      from:'mrp.production',relation:'workorder_ids',to:'mrp.workorder',
      keyMaps:[{fieldName:'id',relatedFieldName:'production_id'}],relationshipKind:'schema_reference'
    }]
  }];
  const graph=deriveEntityGraphForEdge({
    edge:{id:'e1'},
    workflowEvidence:[{workflowId:'wf-1',stageIndexes:[0,1]}],
    workflows
  });
  assert.deepEqual(graph.entities.map(x=>x.name).sort(),['mrp.production','mrp.workorder']);
  assert.equal(graph.relationships.length,1);
  assert.equal(graph.relationships[0].evidenced,true);
  assert.deepEqual(graph.missing,[]);
});

test('unresolved relationship keys remain explicit evidence gaps', () => {
  const workflows=[{
    id:'wf-1',workflowSteps:[{name:'A',entities:['a']},{name:'B',entities:['b']}],
    relationshipDetails:[{from:'a',relation:'links',to:'b',keyMaps:[]}]
  }];
  const graph=deriveEntityGraphForEdge({edge:{id:'e1'},workflowEvidence:[{workflowId:'wf-1',stageIndexes:[0,1]}],workflows});
  assert.ok(graph.missing.some(x=>x.includes('Join keys unresolved')));
});

test('investigations persist and causal fragments can be reused structurally', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lemap-v5-'));
  const store=createInvestigationStore(root);
  const fragments=createCausalFragmentStore(root);
  const record=store.create({
    question:'why output low?',repoUrl:'repo',commit:'c1',
    causalGraph:{
      nodes:[{id:'n1',label:'component shortage'},{id:'n2',label:'manufacturing readiness'}],
      edges:[{id:'e1',from:'n1',to:'n2',hypothesis:'shortage blocks readiness',status:'entity_connected',
        workflowEvidence:[{workflowId:'wf-1',confidence:0.9}],entityEvidence:[{entities:[{name:'mrp.production'}]}]}]
    }
  });
  fragments.upsertFromInvestigation(record);
  const nodes=new Map(record.causalGraph.nodes.map(n=>[n.id,n]));
  const matches=fragments.match(record.causalGraph.edges[0],nodes,'repo');
  assert.equal(matches.length,1);
  assert.equal(matches[0].workflowEvidence[0].workflowId,'wf-1');
  assert.equal(store.get(record.id).question,'why output low?');
});
