import { encodePalArray, emptyPalArray } from './structuralPalSchema.js';

const arr = (value) => Array.isArray(value) ? value : [];

function startOf(row) {
  return Number(String(row?.line_range || '').split('-')[0] || 0);
}

function endOf(row) {
  const parts = String(row?.line_range || '').split('-');
  return Number(parts[1] || parts[0] || 0);
}

function rowKey(file, start, end) {
  return `${String(file || '')}:${Number(start || 0)}:${Number(end || start || 0)}`;
}

function decodeArray(value) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function addParallelLink(row, targetRow, relationship) {
  if (!row || !targetRow || !relationship) return;
  const links = decodeArray(row.links);
  const relationships = decodeArray(row.relationships);
  const target = String(targetRow);
  if (links.some((value, index) => value === target && relationships[index] === relationship)) return;
  links.push(target);
  relationships.push(String(relationship));
  row.links = encodePalArray(links);
  row.relationships = encodePalArray(relationships);
}

function normalizeExistingRows(rows) {
  return arr(rows).map((row) => {
    const normalized = {
      ...row,
      links: row?.links || emptyPalArray(),
      relationships: row?.relationships || emptyPalArray(),
      flowRows: row?.flowRows || emptyPalArray(),
      details: row?.details || ''
    };
    for (const child of decodeArray(row?.children)) addParallelLink(normalized, child, 'contains');
    for (const callee of decodeArray(row?.callees)) addParallelLink(normalized, callee, 'calls');
    return normalized;
  });
}

function existingNodeRows(rows) {
  const functionRows = new Map();
  const spanRows = new Map();

  for (const row of rows) {
    const file = String(row?.file || '');
    const start = startOf(row);
    const end = endOf(row);
    if (row?.type === 'function') functionRows.set(`${file}:${start}`, Number(row.row));
    const key = rowKey(file, start, end);
    if (!spanRows.has(key)) spanRows.set(key, []);
    spanRows.get(key).push(Number(row.row));
  }

  return { functionRows, spanRows };
}

function sourceRowForLink(link, indexes) {
  if (link?.sourceType === 'function') {
    return indexes.functionRows.get(`${link.sourcePath}:${Number(link.startLine || 0)}`) || 0;
  }

  const exact = indexes.spanRows.get(rowKey(link?.sourcePath, link?.startLine, link?.endLine)) || [];
  if (exact.length) return exact[0];

  let best = 0;
  let bestSpan = Number.MAX_SAFE_INTEGER;
  for (const [key, rowNumbers] of indexes.spanRows.entries()) {
    const [file, startText, endText] = key.split(':');
    if (file !== String(link?.sourcePath || '')) continue;
    const start = Number(startText || 0);
    const end = Number(endText || 0);
    const line = Number(link?.startLine || 0);
    if (start <= line && line <= end && (end - start) < bestSpan) {
      best = rowNumbers[0] || 0;
      bestSpan = end - start;
    }
  }
  return best;
}

export function materializeStructuralEvidenceRows({
  baseRows = [],
  entityNodes = [],
  entityLinks = [],
  workflowNodes = []
} = {}) {
  const rows = normalizeExistingRows(baseRows);
  const indexes = existingNodeRows(rows);
  const rowByNodeId = new Map();
  const nextRow = () => rows.length + 1;

  for (const node of arr(entityNodes).filter((item) => item?.type === 'entity')) {
    const row = nextRow();
    rowByNodeId.set(node.id, row);
    rows.push({
      row,
      file: '',
      line_range: '',
      type: 'entity',
      name: String(node.details?.name || node.id),
      parent: '',
      children: emptyPalArray(),
      callers: emptyPalArray(),
      callees: emptyPalArray(),
      links: emptyPalArray(),
      relationships: emptyPalArray(),
      flowRows: emptyPalArray(),
      details: JSON.stringify({
        kind: node.details?.kind || '',
        aliases: node.details?.aliases || [],
        annotations: node.details?.annotations || [],
        origins: node.details?.origins || [],
        members: node.details?.members || [],
        methods: node.details?.methods || [],
        keys: node.details?.keys || [],
        functionCount: Number(node.details?.functionCount || 0),
        flowEdgeCount: Number(node.details?.flowEdgeCount || 0),
        coreScore: Number(node.details?.coreScore || 0)
      })
    });
  }

  for (const link of arr(entityLinks)) {
    const sourceRow = sourceRowForLink(link, indexes);
    const targetRow = rowByNodeId.get(link?.targetId) || 0;
    if (!sourceRow || !targetRow) continue;
    addParallelLink(rows[sourceRow - 1], targetRow, String(link.relationship || ''));
  }

  for (const node of arr(workflowNodes).filter((item) => item?.type === 'workflow')) {
    const graphNodeById = new Map(arr(entityNodes).map((candidate) => [candidate?.id, candidate]));
    const functionRows = arr(node.links)
      .filter((link) => link?.relationship === 'contains')
      .map((link) => {
        const functionNode = graphNodeById.get(link.id);
        if (functionNode?.type !== 'function') return 0;
        return indexes.functionRows.get(
          `${functionNode.details?.sourcePath}:${Number(functionNode.details?.startLine || 0)}`
        ) || 0;
      })
      .filter(Boolean);

    const row = nextRow();
    const workflowLinks = functionRows.map(String);
    rows.push({
      row,
      file: '',
      line_range: '',
      type: 'workflow',
      name: String(node.details?.name || node.id),
      parent: '',
      children: emptyPalArray(),
      callers: emptyPalArray(),
      callees: emptyPalArray(),
      links: encodePalArray(workflowLinks),
      relationships: encodePalArray(workflowLinks.map(() => 'contains')),
      flowRows: encodePalArray(workflowLinks),
      details: JSON.stringify({
        callPathId: node.details?.callPathId || '',
        functionCount: Number(node.details?.functionCount || functionRows.length),
        entityCount: Number(node.details?.entityCount || 0),
        branchVariantCount: Number(node.details?.branchVariantCount || 0),
        alternateEntranceCount: Number(node.details?.alternateEntranceCount || 0)
      })
    });
  }

  return rows;
}
