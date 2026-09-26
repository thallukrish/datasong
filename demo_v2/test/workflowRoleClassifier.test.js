import test from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkflowRoles, workflowSummaries } from '../server/analysis/workflowRoleClassifier.js';

const link=(nodeId,relationship)=>({nodeId,relationship});
test('workflow summaries include workflow semantics, steps and entities',()=>{
  const graph=[
    {id:'w1',type:'workflow',name:'Make product',data:{priorityClass:'core_business',intent:'Build goods'},links:[link('s1','contains step'),link('e1','uses entity')]},
    {id:'s1',type:'step',name:'Produce',data:{order:1,description:'Run production'},links:[]},
    {id:'e1',type:'entity',name:'mrp.production',data:{},links:[]}
  ];
  const [w]=workflowSummaries(graph);
  assert.equal(w.id,'w1');
  assert.equal(w.steps[0].name,'Produce');
  assert.deepEqual(w.entities,['mrp.production']);
});
test('workflow role backfill persists role evidence on workflow data',()=>{
  const graph=[{id:'w1',type:'workflow',name:'Make product',data:{},links:[]}];
  const count=applyWorkflowRoles(graph,[{id:'w1',functionalRole:'core',confidence:.9,reason:'Primary manufacturing capability'}]);
  assert.equal(count,1);
  assert.equal(graph[0].data.functionalRole,'core');
  assert.equal(graph[0].data.functionalRoleModelVersion,'enterprise-functional-role-v1');
});
