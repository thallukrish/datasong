import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeEntrySelectionPlan, scanRepositoryPatterns, scanConstructIndex, constructIndexSummary, rankPatternEntryHits } from '../server/query_v5/codeEntrySelector.js';

test('entry selection accepts regex code searches and rejects literal grep terms', () => {
  const plan=normalizeEntrySelectionPlan({
    strategy:'pattern_search',
    patterns:[
      {pattern:'\\bField\\s*\\([^)]*\\binitial\\s*=',kind:'regex',weight:5},
      {pattern:'Field',kind:'literal',weight:1}
    ]
  });
  assert.equal(plan.strategy,'pattern_search');
  assert.deepEqual(plan.patterns.map(item=>item.pattern),['\\bField\\s*\\([^)]*\\binitial\\s*=']);
  assert.ok(plan.patterns.every(item=>item.kind==='regex'));
});

test('regex code entry selection maps structural matches to enclosing symbols and ranks production above tests', async () => {
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
    assert.equal(ranked[0].test,false);
    assert.equal(ranked[1].symbolId,'test');
    assert.equal(ranked[1].test,true);
    assert.ok(ranked[0].score>ranked[1].score);
  }finally{
    await fs.rm(repoDir,{recursive:true,force:true});
  }
});


test('structural entry search filters AST construct metadata before candidate ranking', () => {
  const topology={
    symbols:[
      {id:'prod',name:'build_setting',sourcePath:'src/config.py',startLine:1,endLine:5},
      {id:'test',name:'test_setting',sourcePath:'tests/test_config.py',startLine:1,endLine:5}
    ],
    externalSymbols:[],
    constructIndex:[
      {constructType:'call',name:'Field',sourcePath:'src/config.py',startLine:3,endLine:3,snippet:'value = Field(default=None)',parentFunction:'build_setting',keywordArgs:['default']},
      {constructType:'call',name:'Field',sourcePath:'tests/test_config.py',startLine:3,endLine:3,snippet:'value = Field(default=None, initial=True)',parentFunction:'test_setting',keywordArgs:['default','initial']},
      {constructType:'condition',name:'',sourcePath:'src/config.py',startLine:4,endLine:4,snippet:'if value is None:',parentFunction:'build_setting'}
    ]
  };
  const summary=constructIndexSummary(topology.constructIndex);
  const plan=normalizeEntrySelectionPlan({
    strategy:'structured_search',
    searches:[{
      construct:'call',
      weight:5,
      filters:[
        {field:'name',regex:'^Field$'},
        {field:'keywordArgs',regex:'^initial$'}
      ]
    }]
  },summary);
  assert.equal(plan.strategy,'structured_search');
  const hits=scanConstructIndex({topology,searches:plan.searches});
  assert.equal(hits.length,1);
  assert.equal(hits[0].sourcePath,'tests/test_config.py');
  assert.equal(hits[0].symbolId,'test');
  assert.match(hits[0].text,/Field\(default=None, initial=True\)/);
});
