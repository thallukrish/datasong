import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeStructuralEvidenceRows } from '../server/semantics/code/structuralPalEvidenceRows.js';

test('unified PAL rows use minimal schema with parallel links and workflow flowRows in details', () => {
  const baseRows = [
    { row:1, file:'a.py', line_range:'1-5', type:'function', name:'A', parent:'', children:'[]', callers:'[]', callees:'["2"]' },
    { row:2, file:'b.py', line_range:'10-15', type:'function', name:'B', parent:'', children:'[]', callers:'["1"]', callees:'[]' },
    { row:3, file:'b.py', line_range:'11-13', type:'if', name:'if', parent:2, children:'[]', callers:'[]', callees:'[]' }
  ];

  const entityNodes = [
    { id:'A', type:'function', details:{ sourcePath:'a.py', startLine:1, endLine:5 }, links:[] },
    { id:'B', type:'function', details:{ sourcePath:'b.py', startLine:10, endLine:15 }, links:[] },
    { id:'B:region:1', type:'function-region', details:{ sourcePath:'b.py', startLine:11, endLine:13 }, links:[] },
    { id:'entity:X', type:'entity', details:{ name:'X', kind:'mapping', functionCount:2, flowEdgeCount:1, coreScore:3 }, links:[] }
  ];

  const entityLinks = [
    {
      sourceId:'A', sourceType:'function', relationship:'create',
      targetId:'entity:X', functionId:'A', regionId:'',
      sourcePath:'a.py', startLine:4, endLine:4
    },
    {
      sourceId:'B:region:1', sourceType:'function-region', relationship:'update',
      targetId:'entity:X', functionId:'B', regionId:'B:region:1',
      sourcePath:'b.py', startLine:12, endLine:12
    }
  ];

  const workflowNodes = [{
    id:'workflow:W',
    type:'workflow',
    details:{ name:'W', callPathId:'callpath:0', functionCount:2, entityCount:1 },
    links:[
      { id:'A', relationship:'contains' },
      { id:'B', relationship:'contains' }
    ]
  }];

  const rows = materializeStructuralEvidenceRows({
    baseRows,
    entityNodes,
    entityLinks,
    workflowNodes
  });

  const a = rows.find((row) => row.row === 1);
  const region = rows.find((row) => row.row === 3);
  const entity = rows.find((row) => row.type === 'entity');
  const workflow = rows.find((row) => row.type === 'workflow');

  assert.ok(entity);
  assert.ok(workflow);

  const aLinks = JSON.parse(a.links);
  const aRelationships = JSON.parse(a.relationships);
  assert.equal(aLinks.length, aRelationships.length);
  assert.ok(aLinks.some((value, index) => value === '2' && aRelationships[index] === 'calls'));
  assert.ok(aLinks.some((value, index) => value === String(entity.row) && aRelationships[index] === 'create'));

  const regionLinks = JSON.parse(region.links);
  const regionRelationships = JSON.parse(region.relationships);
  assert.ok(regionLinks.some((value, index) => value === String(entity.row) && regionRelationships[index] === 'update'));

  assert.deepEqual(JSON.parse(workflow.links), ['1','2']);
  assert.deepEqual(JSON.parse(workflow.relationships), ['contains','contains']);
  assert.deepEqual(JSON.parse(workflow.details).flowRows, [1,2]);

  const expectedColumns = ['row','file','line_range','type','name','links','relationships','details'];
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), expectedColumns);
    assert.equal(JSON.parse(row.links).length, JSON.parse(row.relationships).length);
    assert.equal('parent' in row, false);
    assert.equal('children' in row, false);
    assert.equal('callers' in row, false);
    assert.equal('callees' in row, false);
    assert.equal('flowRows' in row, false);
    assert.equal('features' in row, false);
  }
});
