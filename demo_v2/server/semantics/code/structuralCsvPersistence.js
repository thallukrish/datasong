import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const arr = (value) => Array.isArray(value) ? value : [];

function repoKey(repoUrl) {
  return crypto.createHash('sha1')
    .update(String(repoUrl || '').trim().replace(/\/$/, ''))
    .digest('hex')
    .slice(0, 16);
}

function csvValue(value) {
  if (Array.isArray(value)) value = value.join('|');
  else if (value && typeof value === 'object') value = JSON.stringify(value);
  const text = String(value ?? '');
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csv(columns, rows) {
  return [
    columns.join(','),
    ...arr(rows).map((row) => columns.map((column) => csvValue(row?.[column])).join(','))
  ].join('\n') + '\n';
}

function entityNodeRows(nodes) {
  return arr(nodes)
    .filter((node) => node?.type === 'entity')
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: node.details?.name || '',
      kind: node.details?.kind || '',
      aliases: arr(node.details?.aliases),
      annotations: arr(node.details?.annotations),
      origins: arr(node.details?.origins),
      members: arr(node.details?.members),
      methods: arr(node.details?.methods),
      keys: arr(node.details?.keys),
      functionCount: Number(node.details?.functionCount || 0),
      flowEdgeCount: Number(node.details?.flowEdgeCount || 0),
      coreScore: Number(node.details?.coreScore || 0)
    }));
}

function workflowNodeRows(nodes) {
  return arr(nodes)
    .filter((node) => node?.type === 'workflow')
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: node.details?.name || '',
      entryFunctionId: node.details?.entryFunctionId || '',
      exitFunctionId: node.details?.exitFunctionId || '',
      functionCount: Number(node.details?.functionCount || 0),
      entityCount: Number(node.details?.entityCount || 0)
    }));
}

export async function persistStructuralEvidenceCsv({
  cacheRoot,
  repoUrl,
  commit,
  entityNodes = [],
  entityLinks = [],
  workflowNodes = [],
  workflowLinks = []
} = {}) {
  if (!cacheRoot || !repoUrl || !commit) return null;

  const outputDir = path.join(cacheRoot, 'code-structural-csv', repoKey(repoUrl), commit);
  await fs.mkdir(outputDir, { recursive: true });

  const entityNodeColumns = [
    'id','type','name','kind','aliases','annotations','origins','members','methods','keys',
    'functionCount','flowEdgeCount','coreScore'
  ];
  const entityLinkColumns = [
    'sourceId','sourceType','relationship','targetId','targetType','functionId','regionId',
    'sourcePath','startLine','endLine','variable','origin'
  ];
  const workflowNodeColumns = [
    'id','type','name','entryFunctionId','exitFunctionId','functionCount','entityCount'
  ];
  const workflowLinkColumns = [
    'sourceId','sourceType','relationship','targetId','targetType','ordinal','sourcePath','startLine','endLine'
  ];

  const entityRows = entityNodeRows(entityNodes);
  const workflowRows = workflowNodeRows(workflowNodes);

  await Promise.all([
    fs.writeFile(path.join(outputDir, 'entity-nodes.csv'), csv(entityNodeColumns, entityRows), 'utf8'),
    fs.writeFile(path.join(outputDir, 'entity-links.csv'), csv(entityLinkColumns, entityLinks), 'utf8'),
    fs.writeFile(path.join(outputDir, 'workflow-nodes.csv'), csv(workflowNodeColumns, workflowRows), 'utf8'),
    fs.writeFile(path.join(outputDir, 'workflow-links.csv'), csv(workflowLinkColumns, workflowLinks), 'utf8')
  ]);

  return {
    outputDir,
    entityNodeCount: entityRows.length,
    entityLinkCount: arr(entityLinks).length,
    workflowNodeCount: workflowRows.length,
    workflowLinkCount: arr(workflowLinks).length
  };
}
