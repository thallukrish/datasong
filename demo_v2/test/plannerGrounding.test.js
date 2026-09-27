import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlannerGrounding } from '../server/query_v5/plannerGrounding.js';

const link=(nodeId,relationship)=>({nodeId,relationship});
test('planner grounding combines Odoo framework prior with role-ranked learned semantics',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'lemap-grounding-'));
  const dir=path.join(root,'semantic-maps'); fs.mkdirSync(dir,{recursive:true});
  const repoUrl='https://github.com/acme/ems';
  const graph=[
    {id:'w1',type:'workflow',name:'Confirm manufacturing order',data:{functionalRole:'core',functionalRoleConfidence:.95,intent:'Start production',outcome:'MO confirmed'},links:[link('e1','uses entity'),link('s1','contains step')]},
    {id:'s1',type:'step',name:'Confirm MO',data:{},links:[link('e1','touches entity'),link('e2','touches entity'),link('e3','touches entity')]},
    {id:'e1',type:'entity',name:'mrp.production',data:{description:'Manufacturing order'},links:[]},
    {id:'e2',type:'entity',name:'stock.move',data:{},links:[]},
    {id:'e3',type:'entity',name:'mrp.workorder',data:{},links:[]}
  ];
  fs.writeFileSync(path.join(dir,'map.json'),JSON.stringify({repoUrl,graph}));
  const topology={
    frameworkKind:'odoo',
    odooDetection:{version:'19',addons:[{name:'acme_ems',depends:['mrp','stock','purchase']}]},
    odooFrameworkSummary(){return {modules:['mrp','stock']};}
  };
  const result=buildPlannerGrounding({dataRoot:root,repoUrl,topology,entityLimit:5,workflowLimit:5});
  assert.equal(result.framework.name,'Odoo');
  assert.equal(result.framework.version,'19');
  assert.ok(result.framework.modules.includes('purchase'));
  assert.equal(result.learned.coreWorkflows[0].functionalRole,'core');
  assert.equal(result.learned.coreEntities[0].name,'mrp.production');
  fs.rmSync(root,{recursive:true,force:true});
});
