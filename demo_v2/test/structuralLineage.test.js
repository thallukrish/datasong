import test from 'node:test';
import assert from 'node:assert/strict';

import { structuralLineageForState, compactStructuralLineage } from '../server/semantics/code/structuralLineage.js';
import {
  materializeCodeStructure,
  materializeStructuralLineage,
  applyStructuralSemantics,
  semanticDetails
} from '../server/semantics/code/codeGraph.js';

function explorerFixture(){
  const rows=[
    {
      row:1,file:'x.py',line_range:'10-20',type:'function',name:'transform',
      links:'["2"]',relationships:'["contains"]',details:'{}'
    },
    {
      row:2,file:'x.py',line_range:'12-14',type:'region',name:'transform_region',
      links:'["3"]',relationships:'["update"]',details:'{}'
    },
    {
      row:3,file:'',line_range:'',type:'entity',name:'record',
      links:'[]',relationships:'[]',
      details:JSON.stringify({
        structuralId:'entity:record',
        kind:'mapping',
        keys:['name','value']
      })
    },
    {
      row:4,file:'',line_range:'',type:'workflow',name:'callpath:0',
      links:'["1"]',relationships:'["contains"]',
      details:JSON.stringify({
        structuralId:'workflow:main',
        callPathId:'callpath:0',
        functionCount:1,
        branchVariantCount:1,
        alternateEntranceCount:0
      })
    }
  ];

  const symbol={
    id:'symbol:x.py#transform@10',
    name:'transform',
    sourcePath:'x.py',
    startLine:10,
    endLine:20,
    signature:'transform(record)',
    references:[],
    regions:[]
  };

  return {
    state:{learnedGraph:[]},
    topology:{
      codeStructureRows:rows,
      symbolById:new Map([[symbol.id,symbol]])
    }
  };
}

test('structural lineage resolves entity operations and containing workflows for a function',()=>{
  const explorer=explorerFixture();
  const state={
    id:'symbol:x.py#transform@10',
    type:'code_symbol',
    name:'transform',
    symbolId:'symbol:x.py#transform@10',
    sourcePath:'x.py',
    startLine:10,
    endLine:20
  };

  const lineage=structuralLineageForState(state,explorer);

  assert.deepEqual(lineage.entities.map(item=>[
    item.id,item.operation,item.name,item.description
  ]),[
    ['entity:record','update','record','mapping; keys=name,value']
  ]);
  assert.deepEqual(lineage.flows.map(item=>[
    item.id,item.name,item.position,item.functionCount
  ]),[
    ['workflow:main','callpath:0',1,1]
  ]);

  assert.deepEqual(compactStructuralLineage(lineage),{
    entities:[['update','record','mapping; keys=name,value']],
    flows:[['callpath:0',1,1]]
  });
});

test('learned graph keeps deterministic function-entity-flow relationships while adding semantics',()=>{
  const explorer=explorerFixture();
  const state={
    id:'symbol:x.py#transform@10',
    type:'code_symbol',
    name:'transform',
    symbolId:'symbol:x.py#transform@10',
    sourcePath:'x.py',
    startLine:10,
    endLine:20
  };

  materializeCodeStructure(explorer,[state]);
  const lineage=structuralLineageForState(state,explorer);
  materializeStructuralLineage(explorer,state,lineage);

  const byId=new Map(explorer.state.learnedGraph.map(node=>[node.id,node]));
  const fn=byId.get(state.id);
  const entity=byId.get('entity:record');
  const workflow=byId.get('workflow:main');

  assert.ok(fn.links.some(link=>link.nodeId==='entity:record'&&link.relationship==='update'));
  assert.ok(fn.links.some(link=>link.nodeId==='workflow:main'&&link.relationship==='in-flow'));
  assert.ok(entity.links.some(link=>link.nodeId===state.id&&link.relationship==='used-by'));
  assert.ok(workflow.links.some(link=>link.nodeId===state.id&&link.relationship==='contains'));

  applyStructuralSemantics(explorer,{
    entities:[{entityId:'entity:record',purpose:'Mutable record',effect:'Carries transformed values'}],
    workflows:[{workflowId:'workflow:main',purpose:'Transformation flow',effect:'Runs transform'}]
  });

  assert.equal(semanticDetails(explorer,{id:'entity:record'}).purpose,'Mutable record');
  assert.equal(semanticDetails(explorer,{id:'workflow:main'}).purpose,'Transformation flow');

  assert.ok(fn.links.some(link=>link.nodeId==='entity:record'&&link.relationship==='update'));
  assert.ok(workflow.links.some(link=>link.nodeId===state.id&&link.relationship==='contains'));
});
