import test from 'node:test';
import assert from 'node:assert/strict';
import { rankCoreEntities } from '../server/analysis/coreEntityRanking.js';

function node(id,type,name,data={},links=[]) { return { id,type,name,data,links }; }
function link(nodeId,relationship,data={}) { return { nodeId,relationship,data }; }

test('functional workflow semantics lift core business entities above connected helpers', () => {
  const graph=[
    node('wf1','workflow','Order fulfilment',{priorityClass:'core_business'},[
      link('eOrder','uses entity'),link('eLine','uses entity'),link('s1','contains step')
    ]),
    node('s1','step','Confirm order',{},[link('eOrder','touches entity'),link('eLine','touches entity')]),
    node('wf2','workflow','Operations audit',{priorityClass:'technical'},[link('eAudit','uses entity')]),
    node('eOrder','entity','sale.order',{schemaResolved:true},[
      link('eLine','contains',{relationshipKind:'schema_fk',keyMaps:[{fieldName:'id',relatedFieldName:'order_id'}]}),
      link('eHelper','references',{relationshipKind:'schema_reference'})
    ]),
    node('eLine','entity','sale.order.line',{schemaResolved:true},[
      link('eHelper','references',{relationshipKind:'schema_reference'})
    ]),
    node('eHelper','entity','generic.bridge',{schemaResolved:true},[
      link('eAudit','references',{relationshipKind:'schema_reference'}),
      link('eRef','references',{relationshipKind:'schema_reference'})
    ]),
    node('eAudit','entity','audit.log',{schemaResolved:true}),
    node('eRef','entity','reference.table',{schemaResolved:true})
  ];
  const ranked=rankCoreEntities(graph,{limit:10});
  const byName=new Map(ranked.map(x=>[x.entity,x]));
  assert.equal(byName.get('sale.order').role,'functional');
  assert.equal(byName.get('audit.log').role,'technical');
  assert.equal(byName.get('generic.bridge').role,'helper');
  assert.ok(byName.get('sale.order').coreScore > byName.get('generic.bridge').coreScore);
});

test('entity spanning business and technical workflows is marked mixed', () => {
  const graph=[
    node('wf1','workflow','Business',{priorityClass:'operational'},[link('e1','uses entity')]),
    node('wf2','workflow','Admin',{priorityClass:'technical'},[link('e1','uses entity')]),
    node('e1','entity','shared.entity',{})
  ];
  const [ranked]=rankCoreEntities(graph,{limit:1});
  assert.equal(ranked.role,'mixed');
});

test('cross-workflow neighbour raises handoff evidence', () => {
  const graph=[
    node('wf1','workflow','Sales',{priorityClass:'core_business'},[link('a','uses entity')]),
    node('wf2','workflow','Manufacturing',{priorityClass:'operational'},[link('b','uses entity')]),
    node('a','entity','sale.order',{},[link('b','creates',{relationshipKind:'schema_fk',keyMaps:[{fieldName:'id',relatedFieldName:'origin_id'}]})]),
    node('b','entity','mrp.production',{})
  ];
  const ranked=rankCoreEntities(graph,{limit:2});
  assert.equal(ranked[0].crossWorkflowNeighbourCount,1);
  assert.equal(ranked[1].crossWorkflowNeighbourCount,1);
});

test('explicit workflow functionalRole overrides legacy priorityClass for ranking', () => {
  const graph=[
    node('wf1','workflow','Peripheral UI action',{priorityClass:'core_business',functionalRole:'incidental'},[
      link('e1','uses entity'),link('s1','contains step')
    ]),
    node('s1','step','Open wizard',{},[link('e1','touches entity')]),
    node('wf2','workflow','Primary operation',{priorityClass:'support',functionalRole:'core'},[
      link('e2','uses entity'),link('s2','contains step')
    ]),
    node('s2','step','Run operation',{},[link('e2','touches entity'),link('e2b','touches entity'),link('e2c','touches entity')]),
    node('e1','entity','ui.action',{}),
    node('e2','entity','business.order',{}),
    node('e2b','entity','business.line',{}),
    node('e2c','entity','business.event',{})
  ];
  const ranked=rankCoreEntities(graph,{limit:10});
  const byName=new Map(ranked.map(x=>[x.entity,x]));
  assert.equal(byName.get('ui.action').incidentalWorkflowCount,1);
  assert.equal(byName.get('business.order').functionalWorkflowCount,1);
  assert.ok(byName.get('business.order').coreScore > byName.get('ui.action').coreScore);
});
