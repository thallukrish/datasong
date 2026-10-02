import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeEntrySelectionPlan, scanRepositoryPatterns, scanConstructIndex, constructIndexSummary, rankPatternEntryHits, walkConstructFacets } from '../server/query_v5/codeEntrySelector.js';

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


test('structured ranking prefers exact metadata matches, then prefix matches, then contains matches', () => {
  const topology={
    symbols:[
      {id:'exact',name:'exact_fn',sourcePath:'a.py',startLine:1,endLine:3},
      {id:'prefix',name:'prefix_fn',sourcePath:'b.py',startLine:1,endLine:3},
      {id:'contains',name:'contains_fn',sourcePath:'c.py',startLine:1,endLine:3}
    ],
    externalSymbols:[],
    constructIndex:[
      {constructType:'call',name:'Field',sourcePath:'a.py',startLine:2,endLine:2,snippet:'Field ( initial = "x" )',canonicalSnippet:'Field(initial="x")',parentFunction:'exact_fn',keywordArgs:['initial']},
      {constructType:'call',name:'FieldFactory',sourcePath:'b.py',startLine:2,endLine:2,snippet:'FieldFactory()',canonicalSnippet:'FieldFactory()',parentFunction:'prefix_fn',keywordArgs:[]},
      {constructType:'call',name:'initial_for_Field',sourcePath:'c.py',startLine:2,endLine:2,snippet:'initial_for_Field()',canonicalSnippet:'initial_for_Field()',parentFunction:'contains_fn',keywordArgs:[]}
    ]
  };
  const hits=scanConstructIndex({topology,searches:[{
    construct:'call',
    weight:5,
    filters:[{field:'name',regex:'Field'}]
  }]});
  const ranked=rankPatternEntryHits(hits);
  assert.deepEqual(ranked.map(item=>item.symbolId),['exact','prefix','contains']);
  assert.equal(ranked[0].matches[0].matchQuality.filters[0].quality,'exact');
  assert.equal(ranked[1].matches[0].matchQuality.filters[0].quality,'prefix');
  assert.equal(ranked[2].matches[0].matchQuality.filters[0].quality,'contains');
});

test('structured metadata matching ignores source whitespace around calls and keyword assignment', () => {
  const topology={
    symbols:[{id:'spaced',name:'build',sourcePath:'spaced.py',startLine:1,endLine:3}],
    externalSymbols:[],
    constructIndex:[{
      constructType:'call',
      name:'Field',
      sourcePath:'spaced.py',
      startLine:2,
      endLine:2,
      snippet:'Field ( initial = "x" )',
      canonicalSnippet:'Field(initial="x")',
      parentFunction:'build',
      keywordArgs:['initial']
    }]
  };
  const hits=scanConstructIndex({topology,searches:[{
    construct:'call',
    weight:5,
    filters:[
      {field:'name',regex:'^Field$'},
      {field:'keywordArgs',regex:'^initial$'}
    ]
  }]});
  assert.equal(hits.length,1);
  assert.equal(hits[0].matchQuality.exact,2);
});


test('faceted structural walk materializes once exact Field anchor yields a small set', async () => {
  const topology={
    files:['a.py','b.py','c.py'],
    constructIndex:[
      {constructType:'call',name:'Field',keywordArgs:['default'],sourcePath:'a.py',startLine:1,endLine:1,snippet:'Field(default=1)'},
      {constructType:'call',name:'Field',keywordArgs:['initial'],sourcePath:'b.py',startLine:1,endLine:1,snippet:'Field(initial="x")'},
      {constructType:'call',name:'FieldFactory',keywordArgs:['initial'],sourcePath:'c.py',startLine:1,endLine:1,snippet:'FieldFactory(initial="x")'},
      ...Array.from({length:30},(_,i)=>({constructType:'call',name:'other'+i,keywordArgs:[],sourcePath:'x'+i+'.py',startLine:1,endLine:1,snippet:'other'+i+'()'}))
    ]
  };
  const replies=[
    {action:'select_construct',construct:'call',reason:'Issue is call-related'},
    {action:'refine',field:'name',match:'exact',value:'Field',facetSort:'alpha',reason:'Concrete identifier'}
  ];
  let callIndex=0;
  const client={chat:{completions:{create:async()=>({
    choices:[{message:{content:JSON.stringify(replies[callIndex++])}}],
    usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}
  })}}};
  const usage={prompt:0,completion:0,total:0};
  const walked=await walkConstructFacets({question:'Field initial warning',mode:'causal',topology,client,model:'mock',usage});
  assert.equal(walked.strategy,'structured_search');
  assert.equal(walked.construct,'call');
  assert.equal(walked.rows.length,2);
  assert.equal(walked.rows[0].name,'Field');
  assert.ok(walked.rows.some((row)=>row.name==='Field'&&row.keywordArgs.includes('initial')));
  assert.ok(walked.rows.some((row)=>row.name==='Field'&&row.keywordArgs.includes('default')));
  assert.equal(walked.history.length,2);
  assert.equal(usage.total,4);
});
