import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PAL } from 'pal-executor-lib';
import { analyzePythonRepository } from '../server/languages/python/adapter.js';
import { buildPythonDataStructureGraph } from '../server/languages/python/dataStructureGraph.js';
import { buildCompactCallFlows } from '../server/semantics/code/compactCallFlows.js';
import { buildWorkflowGraph } from '../server/semantics/code/structuralEvidenceGraph.js';
import { materializeStructuralEvidenceRows } from '../server/semantics/code/structuralPalEvidenceRows.js';
import {
  STRUCTURAL_PAL_COLUMNS,
  STRUCTURAL_PAL_COLUMN_TYPES
} from '../server/semantics/code/structuralPalSchema.js';
import { CodeTopology } from '../server/topology.js';

function hydrateIndexes(indexes) {
  const valuesIndex = {};

  for (const [column, pairs] of Object.entries(indexes.valuesIndex || {})) {
    const columnMap = new Map();
    for (const [rowKey, value] of pairs || []) {
      if (!columnMap.has(rowKey)) {
        columnMap.set(rowKey, value);
        continue;
      }
      const prior = columnMap.get(rowKey);
      columnMap.set(rowKey, Array.isArray(prior) ? [...prior, value] : [prior, value]);
    }
    valuesIndex[column] = columnMap;
  }

  return {
    uniqueIndex: new Map(
      Object.entries(indexes.uniqueIndex || {}).map(([column, values]) => [column, new Set(values)])
    ),
    valuesIndex
  };
}

function expandRanges(ranges = []) {
  const out = [];
  for (const item of ranges) {
    const text = String(item);
    if (!text.includes('-')) {
      out.push(Number(text));
      continue;
    }
    const [start, end] = text.split('-').map(Number);
    for (let value = start; value <= end; value += 1) out.push(value);
  }
  return out;
}

function runFilter({ expression, rows, indexes }) {
  const { uniqueIndex, valuesIndex } = hydrateIndexes(indexes);
  const attributesOriginalMap = Object.fromEntries(
    Object.keys(indexes.valuesIndex || {}).map((column) => [column, column])
  );

  const queryGraph = {
    question: expression,
    graph: [
      {
        name: 'data',
        type: 'table',
        count: '1',
        link: [
          {
            step: 1,
            name: 'filtered',
            cmd: `FILTER data,${expression},filtered`,
            desc: 'Independent structural PAL filter'
          }
        ]
      },
      {
        name: 'filtered',
        type: 'table',
        count: '1',
        link: [{ name: 'data' }]
      }
    ]
  };

  return PAL.execCommand_new(
    JSON.stringify(queryGraph),
    {},
    STRUCTURAL_PAL_COLUMN_TYPES,
    rows.length,
    uniqueIndex,
    valuesIndex,
    attributesOriginalMap,
    null
  );
}

test('independent Python structural graphs -> CSV -> PAL indexes -> filters', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'datasong-structural-pal-'));
  const repoDir = path.join(root, 'repo');
  await fs.mkdir(repoDir, { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  await fs.writeFile(path.join(repoDir, 'pipeline.py'), `
def save(record):
    return record["name"]

def normalize(record):
    name = record["name"]
    record["value"] = record["value"] + 1
    return save(record)

def load():
    record = {"name": "a", "value": 1}
    return normalize(record)

def run():
    return load()
`);

  const analysis = await analyzePythonRepository({
    repoDir,
    files: ['pipeline.py']
  });

  // Stage 1: function call graph is materialized independently from AST facts.
  const topology = new CodeTopology({ cacheRoot: path.join(root, 'cache') });
  const baseRows = topology.materializeCodeStructureRows(
    analysis.codeFacts || [],
    analysis
  );
  const functionRows = baseRows.filter((row) => row.type === 'function');
  const functionRowByName = new Map(functionRows.map((row) => [row.name, row]));
  const runRow = functionRowByName.get('run');
  const loadRow = functionRowByName.get('load');
  const normalizeRow = functionRowByName.get('normalize');
  const saveRow = functionRowByName.get('save');

  assert.ok(runRow && loadRow && normalizeRow && saveRow, 'Expected persisted function graph rows');

  const callsTarget = (row, targetRow) => {
    const links = JSON.parse(row.links || '[]');
    const relationships = JSON.parse(row.relationships || '[]');
    return links.some((value, index) =>
      value === String(targetRow.row) && relationships[index] === 'calls'
    );
  };

  assert.ok(callsTarget(runRow, loadRow));
  assert.ok(callsTarget(loadRow, normalizeRow));
  assert.ok(callsTarget(normalizeRow, saveRow));

  // Stage 2: derive flow graph from the function graph symbols.
  const compactFlows = buildCompactCallFlows({ symbols: analysis.symbols || [] });
  const symbolByName = new Map((analysis.symbols || []).map((symbol) => [symbol.name, symbol]));
  const run = symbolByName.get('run');
  const load = symbolByName.get('load');
  const normalize = symbolByName.get('normalize');
  const save = symbolByName.get('save');
  assert.ok(run && load && normalize && save);

  const groupedPaths = [{
    id: 'callpath:fixture',
    symbolIds: [run.id, load.id, normalize.id, save.id],
    branchVariantCount: 0,
    alternateEntranceCount: 0
  }];
  const workflowGraph = buildWorkflowGraph({
    groupedPaths,
    symbols: analysis.symbols || []
  });
  assert.equal(workflowGraph.nodes.length, 1, 'Expected independent workflow graph');
  assert.deepEqual(
    workflowGraph.nodes[0].links.map((link) => link.id),
    groupedPaths[0].symbolIds
  );

  const flowRows = materializeStructuralEvidenceRows({
    baseRows,
    workflowNodes: workflowGraph.nodes,
    workflowLinks: workflowGraph.workflowLinks
  });

  // Stage 3: derive entity graph from function + flow + raw dataflow evidence.
  const entityGraph = buildPythonDataStructureGraph({
    symbols: analysis.symbols || [],
    observations: analysis.dataObservations || [],
    transfers: analysis.dataTransfers || [],
    flowSlices: compactFlows.paths || [],
    codeFacts: analysis.codeFacts || [],
    externalSymbols: analysis.externalSymbols || []
  });
  const entityNodesOnly = entityGraph.nodes || [];
  const entityLinks = entityGraph.entityLinks || [];

  const recordEntity = entityNodesOnly.find((node) =>
    node.details?.kind === 'mapping' &&
    (node.details?.keys || []).includes('name') &&
    (node.details?.keys || []).includes('value')
  );
  assert.ok(recordEntity, 'Expected mapping entity graph node');
  assert.ok(entityLinks.some((link) =>
    link.targetId === recordEntity.id && link.relationship === 'create'
  ));
  assert.ok(entityLinks.some((link) =>
    link.targetId === recordEntity.id && link.relationship === 'update'
  ));
  assert.ok(entityLinks.some((link) =>
    link.targetId === recordEntity.id && link.relationship === 'read'
  ));

  const rows = materializeStructuralEvidenceRows({
    baseRows: flowRows,
    entityNodes: entityNodesOnly,
    entityLinks,
    workflowNodes: workflowGraph.nodes,
    workflowLinks: workflowGraph.workflowLinks
  });

  assert.ok(rows.some((row) => row.type === 'function'));
  assert.ok(rows.some((row) => row.type === 'entity'));
  assert.ok(rows.some((row) => row.type === 'workflow'));
  assert.ok(rows.every((row) =>
    JSON.parse(row.links).length === JSON.parse(row.relationships).length
  ));

  const csv = topology.serializeCodeStructureCsv(rows);
  const csvPath = path.join(root, 'python.csv');
  await fs.writeFile(csvPath, csv, 'utf8');
  const persistedCsv = await fs.readFile(csvPath, 'utf8');
  assert.deepEqual(persistedCsv.split(/\r?\n/, 1)[0].split(','), STRUCTURAL_PAL_COLUMNS);

  const parsedRows = topology.parseCodeStructureCsv(persistedCsv);
  assert.equal(parsedRows.length, rows.length);
  assert.deepEqual(Object.keys(parsedRows[0]), STRUCTURAL_PAL_COLUMNS);

  const indexes = topology.buildPalIndexes(parsedRows);
  assert.ok(indexes.uniqueIndex.type.includes('function'));
  assert.ok(indexes.uniqueIndex.type.includes('entity'));
  assert.ok(indexes.uniqueIndex.type.includes('workflow'));
  assert.ok(indexes.uniqueIndex.relationships.includes('calls'));
  assert.ok(indexes.uniqueIndex.relationships.includes('update'));
  assert.ok(indexes.uniqueIndex['details.kind'].includes('mapping'));

  const numericDetail = (indexes.valuesIndex['details.functionCount'] || [])
    .map((entry) => entry[1])
    .find((value) => typeof value === 'number');
  assert.equal(typeof numericDetail, 'number', 'Expected typed JSON numeric detail');

  const entityFilter = runFilter({
    expression: "data.type == 'entity'",
    rows: parsedRows,
    indexes
  });
  assert.equal(entityFilter.error, undefined, `Entity FILTER failed: ${entityFilter.error}`);
  const entityIndexes = expandRanges(entityFilter.context.filtered.value);
  assert.deepEqual(
    entityIndexes,
    parsedRows.map((row, index) => row.type === 'entity' ? index : -1).filter((index) => index >= 0)
  );

  const callFilter = runFilter({
    expression: "data.relationships in ['calls']",
    rows: parsedRows,
    indexes
  });
  assert.equal(callFilter.error, undefined, `Relationship FILTER failed: ${callFilter.error}`);
  const callIndexes = expandRanges(callFilter.context.filtered.value);
  assert.deepEqual(
    callIndexes,
    parsedRows
      .map((row, index) => JSON.parse(row.relationships).includes('calls') ? index : -1)
      .filter((index) => index >= 0)
  );

  console.log(JSON.stringify({
    functionNodes: functionRows.length,
    entityNodes: entityNodesOnly.length,
    entityLinks: entityLinks.length,
    workflowNodes: workflowGraph.nodes.length,
    csvRows: parsedRows.length,
    indexedColumns: indexes.headers.length,
    virtualJsonFields: indexes.headers.filter((name) => name.startsWith('details.')).length,
    csvPath
  }, null, 2));
});
