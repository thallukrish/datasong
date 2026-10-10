import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeEntrySelectionPlan, scanRepositoryPatterns, scanCodeStructureRows, scanCodeStructureRowsWithPal, rankPatternEntryHits } from '../server/query_v5/codeEntrySelector.js';

test('entry selection normalizes exact structural locators', () => {
  const plan=normalizeEntrySelectionPlan({
    action:'locate',
    locators:[
      {type:'function',name:'separability_matrix'},
      {type:'*',name:'obj'}
    ]
  });
  assert.equal(plan.strategy,'structured_search');
  assert.deepEqual(plan.locators,[
    {type:'function',name:'separability_matrix'},
    {type:'*',name:'obj'}
  ]);
});

test('structural CSV search resolves a parameter row through the PAL values index', () => {
  const topology={
    codeStructureRows:[
      {row:1,file:'x.py',line_range:'10-20',type:'function',name:'foobar',parent:'',children:'["2"]'},
      {row:2,file:'x.py',line_range:'10',type:'input_param',name:'a',parent:1,children:'[]'}
    ],
    palValuesIndex:{
      type:[['0','function'],['1','input_param']],
      name:[['0','foobar'],['1','a']]
    },
    symbols:[
      {id:'fn',name:'foobar',sourcePath:'x.py',startLine:10,endLine:20}
    ],
    externalSymbols:[]
  };
  const hits=scanCodeStructureRows({topology,locators:[{type:'input_param',name:'a'}]});
  assert.equal(hits.length,1);
  assert.equal(hits[0].symbolId,'fn');
  assert.equal(hits[0].sourcePath,'x.py');
  assert.equal(hits[0].line,10);
});

test('wildcard type searches the PAL name index without constraining type', () => {
  const topology={
    codeStructureRows:[
      {row:1,file:'x.py',line_range:'10-20',type:'function',name:'foobar',parent:'',children:'["2"]'},
      {row:2,file:'x.py',line_range:'10',type:'input_param',name:'a',parent:1,children:'[]'}
    ],
    palValuesIndex:{
      type:[['0','function'],['1','input_param']],
      name:[['0','foobar'],['1','a']]
    },
    symbols:[
      {id:'fn',name:'foobar',sourcePath:'x.py',startLine:10,endLine:20}
    ],
    externalSymbols:[]
  };
  const hits=scanCodeStructureRows({topology,locators:[{type:'*',name:'a'}]});
  assert.equal(hits.length,1);
  assert.equal(hits[0].symbolId,'fn');
});


test('PAL FILTER resolves typed exact structural locators', async () => {
  const topology={
    codeStructureRows:[
      {row:1,file:'x.py',line_range:'10-20',type:'function',name:'foobar',parent:'',children:'["2"]'},
      {row:2,file:'x.py',line_range:'10',type:'input_param',name:'a',parent:'1',children:'[]'}
    ],
    palUniqueIndex:{
      type:['function','input_param'],
      name:['foobar','a']
    },
    palValuesIndex:{
      type:[['0','function'],['1','input_param']],
      name:[['0','foobar'],['1','a']]
    },
    symbols:[
      {id:'fn',name:'foobar',sourcePath:'x.py',startLine:10,endLine:20}
    ],
    externalSymbols:[]
  };
  const hits=await scanCodeStructureRowsWithPal({topology,locators:[{type:'input_param',name:'a'}]});
  assert.equal(hits.length,1);
  assert.equal(hits[0].symbolId,'fn');
  assert.deepEqual(hits[0].matchQuality.filters,['pal']);
});

test('PAL FILTER wildcard type searches all construct types', async () => {
  const topology={
    codeStructureRows:[
      {row:1,file:'x.py',line_range:'10-20',type:'function',name:'target',parent:'',children:'[]'},
      {row:2,file:'x.py',line_range:'30-31',type:'assignment',name:'target',parent:'',children:'[]'}
    ],
    palUniqueIndex:{type:['function','assignment'],name:['target']},
    palValuesIndex:{
      type:[['0','function'],['1','assignment']],
      name:[['0-1','target']]
    },
    symbols:[
      {id:'fn',name:'target',sourcePath:'x.py',startLine:10,endLine:20},
      {id:'as',name:'target',sourcePath:'x.py',startLine:30,endLine:31}
    ],
    externalSymbols:[]
  };
  const hits=await scanCodeStructureRowsWithPal({topology,locators:[{type:'*',name:'target'}]});
  assert.equal(hits.length,2);
});

test('LeMap trailing wildcard performs prefix expansion from PAL unique values', async () => {
  const topology={
    codeStructureRows:[
      {row:1,file:'x.py',line_range:'10-20',type:'function',name:'validate_user',parent:'',children:'[]'},
      {row:2,file:'x.py',line_range:'30-40',type:'function',name:'prevalidate_order',parent:'',children:'[]'},
      {row:3,file:'x.py',line_range:'50-60',type:'function',name:'render',parent:'',children:'[]'}
    ],
    palUniqueIndex:{type:['function'],name:['validate_user','prevalidate_order','render']},
    palValuesIndex:{
      type:[['0-2','function']],
      name:[['0','validate_user'],['1','prevalidate_order'],['2','render']]
    },
    symbols:[
      {id:'a',name:'validate_user',sourcePath:'x.py',startLine:10,endLine:20},
      {id:'b',name:'prevalidate_order',sourcePath:'x.py',startLine:30,endLine:40},
      {id:'c',name:'render',sourcePath:'x.py',startLine:50,endLine:60}
    ],
    externalSymbols:[]
  };
  const hits=await scanCodeStructureRowsWithPal({topology,locators:[{type:'function',name:'validate*'}]});
  assert.equal(hits.length,1);
  assert.deepEqual(new Set(hits.map(hit=>hit.symbolId)),new Set(['a']));
});

test('regex fallback maps source matches to enclosing symbols and ranks production above tests', async () => {
  const repoDir=await fs.mkdtemp(path.join(os.tmpdir(),'lemap-entry-select-'));
  await fs.mkdir(path.join(repoDir,'src'),{recursive:true});
  await fs.mkdir(path.join(repoDir,'tests'),{recursive:true});
  await fs.writeFile(path.join(repoDir,'src','config.py'),[
    'def build_setting():',
    '    return Field(default=None, initial=True)'
  ].join('\n'));
  await fs.writeFile(path.join(repoDir,'tests','test_config.py'),[
    'def test_setting():',
    '    return Field(default=None, initial=True)'
  ].join('\n'));

  const topology={
    repoDir,
    files:['src/config.py','tests/test_config.py'],
    symbols:[
      {id:'prod',name:'build_setting',sourcePath:'src/config.py',startLine:1,endLine:2},
      {id:'test',name:'test_setting',sourcePath:'tests/test_config.py',startLine:1,endLine:2}
    ],
    externalSymbols:[]
  };
  try{
    const hits=await scanRepositoryPatterns({topology,patterns:[
      {pattern:'\\bField\\s*\\([^)]*\\binitial\\s*=',kind:'regex',weight:5}
    ]});
    const ranked=rankPatternEntryHits(hits);
    assert.equal(ranked[0].symbolId,'prod');
    assert.equal(ranked[1].symbolId,'test');
    assert.ok(ranked[0].score>ranked[1].score);
  }finally{
    await fs.rm(repoDir,{recursive:true,force:true});
  }
});
