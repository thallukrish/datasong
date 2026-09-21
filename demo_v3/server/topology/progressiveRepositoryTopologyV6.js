import fs from 'node:fs/promises';
import path from 'node:path';
import { ProgressiveRepositoryTopologyV5 } from './progressiveRepositoryTopologyV5.js';

function cleanRepoPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function fileId(filePath) { return `file:${cleanRepoPath(filePath)}`; }
function dirId(dirPath) { const p = cleanRepoPath(dirPath); return `dir:${p || '.'}`; }

function compactAttrs(raw = '') {
  const attrs = {};
  const re = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match;
  while ((match = re.exec(raw))) {
    const value = String(match[2] ?? match[3] ?? '').trim();
    attrs[match[1]] = value.length > 180 ? `${value.slice(0, 180)}…` : value;
  }
  return attrs;
}

function xmlNodeId(sourcePath, ordinal) {
  return `xmlnode:${encodeURIComponent(sourcePath)}:${ordinal}`;
}

function parseXmlHierarchy(sourcePath, xml) {
  const nodes = [];
  const roots = [];
  const stack = [];
  const tagRe = /<([^>]+)>/g;
  let match;

  while ((match = tagRe.exec(xml))) {
    const token = String(match[1] || '').trim();
    if (!token || token.startsWith('?') || token.startsWith('!')) continue;
    if (token.startsWith('/')) {
      const closing = token.slice(1).trim().split(/\s+/)[0];
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        const node = stack[i];
        if (node.tag === closing) {
          node.endOffset = tagRe.lastIndex;
          stack.splice(i);
          break;
        }
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(token);
    const open = token.replace(/\/\s*$/, '').trim();
    const tag = open.split(/\s+/)[0];
    if (!tag) continue;
    const attrText = open.slice(tag.length);
    const node = {
      id: xmlNodeId(sourcePath, nodes.length + 1),
      ordinal: nodes.length + 1,
      tag,
      attributes: compactAttrs(attrText),
      children: [],
      parentId: stack.at(-1)?.id || null,
      depth: stack.length,
      startOffset: match.index,
      endOffset: selfClosing ? tagRe.lastIndex : null,
      selfClosing
    };
    nodes.push(node);
    if (stack.length) stack.at(-1).children.push(node.id);
    else roots.push(node.id);
    if (!selfClosing) stack.push(node);
  }

  return { nodes, roots, byId: new Map(nodes.map((node) => [node.id, node])) };
}

function nodeLabel(node) {
  const attrs = node?.attributes || {};
  const identity = attrs.name || attrs.id || attrs['service-name'] || attrs['entity-name'] || attrs.value || '';
  return identity ? `${node.tag}: ${identity}` : node.tag;
}

function childSummary(node, byId) {
  const children = (node?.children || []).map((id) => byId.get(id)).filter(Boolean);
  const tagCounts = {};
  for (const child of children) tagCounts[child.tag] = (tagCounts[child.tag] || 0) + 1;
  return {
    id: node.id,
    tag: node.tag,
    attributes: node.attributes,
    childCount: children.length,
    childTags: Object.entries(tagCounts).map(([tag, count]) => ({ tag, count }))
  };
}

export class ProgressiveRepositoryTopologyV6 extends ProgressiveRepositoryTopologyV5 {
  constructor(options) {
    super(options);
    this.xmlHierarchyByFile = new Map();
    this.xmlNodeById = new Map();
  }

  async prepare(repoUrl) {
    this.xmlHierarchyByFile.clear();
    this.xmlNodeById.clear();
    return super.prepare(repoUrl);
  }

  async xmlHierarchy(sourcePath) {
    const rel = cleanRepoPath(sourcePath);
    if (this.xmlHierarchyByFile.has(rel)) return this.xmlHierarchyByFile.get(rel);
    const abs = path.join(this.repoDir, rel);
    const text = await fs.readFile(abs, 'utf8').catch(() => '');
    const parsed = parseXmlHierarchy(rel, text);
    parsed.sourcePath = rel;
    this.xmlHierarchyByFile.set(rel, parsed);
    for (const node of parsed.nodes) this.xmlNodeById.set(node.id, { sourcePath: rel, node, parsed });
    return parsed;
  }

  nodeCandidates(nodes) {
    return nodes.map((node) => ({
      id: node.id,
      path: `${node.id}`,
      kind: 'xml_node',
      relation: 'contains',
      label: nodeLabel(node),
      hint: JSON.stringify({
        tag: node.tag,
        attributes: node.attributes,
        childCount: node.children.length
      })
    }));
  }

  async inspectXmlFile(sourcePath) {
    const rel = cleanRepoPath(sourcePath);
    this.openedFiles.add(rel);
    const ext = path.posix.extname(rel).toLowerCase();
    const parent = cleanRepoPath(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel));
    const parsed = await this.xmlHierarchy(rel);
    const roots = parsed.roots.map((id) => parsed.byId.get(id)).filter(Boolean);

    // XML documents commonly have a single document root. Showing the root plus
    // its immediate children gives useful hierarchy without shipping raw XML.
    const rootSummaries = roots.map((root) => ({
      ...childSummary(root, parsed.byId),
      children: root.children.map((id) => parsed.byId.get(id)).filter(Boolean).map((child) => childSummary(child, parsed.byId))
    }));
    const exposedChildren = roots.length === 1
      ? roots[0].children.map((id) => parsed.byId.get(id)).filter(Boolean)
      : roots;

    return {
      id: fileId(rel),
      path: rel,
      kind: 'xml_file',
      summary: `${rel}: hierarchical ${ext === '.jmx' ? 'JMeter XML test plan' : 'XML'} overview`,
      canonical: {
        kind: ext === '.jmx' ? 'jmeter_xml_hierarchy' : 'xml_hierarchy',
        path: rel,
        roots: rootSummaries,
        note: 'Pass-1 hierarchical exposure only: root/top-level structure and immediate children. Select a child to reveal its immediate children; raw document content is intentionally not transported.'
      },
      excerpt: '',
      neighbors: this.nodeCandidates(exposedChildren),
      parentDirectory: dirId(parent)
    };
  }

  async inspectXmlNode(id) {
    let entry = this.xmlNodeById.get(id);
    if (!entry) {
      const match = /^xmlnode:([^:]+):(\d+)$/.exec(String(id || ''));
      if (!match) return null;
      const sourcePath = decodeURIComponent(match[1]);
      await this.xmlHierarchy(sourcePath);
      entry = this.xmlNodeById.get(id);
    }
    if (!entry) return null;

    const { sourcePath, node, parsed } = entry;
    const children = node.children.map((childId) => parsed.byId.get(childId)).filter(Boolean);
    const structuredUnits = this.structuredUnitsForFile(sourcePath)
      .filter((symbol) => {
        const signature = `${symbol.name || ''} ${symbol.signature || ''}`.toLowerCase();
        return signature.includes(String(node.tag || '').toLowerCase());
      });

    return {
      id: node.id,
      path: `${sourcePath}#${nodeLabel(node)}`,
      kind: 'xml_file',
      summary: `${sourcePath}: <${node.tag}> hierarchy node`,
      canonical: {
        kind: 'xml_hierarchy_node',
        source: sourcePath,
        node: childSummary(node, parsed.byId),
        children: children.map((child) => childSummary(child, parsed.byId)),
        structuredUnits: structuredUnits.map((symbol) => this.functionDescriptor(symbol)),
        note: 'Only this XML node and its immediate children are exposed. Select a child to descend; select a structured unit when semantic-function detail is needed.'
      },
      excerpt: '',
      neighbors: [
        ...this.nodeCandidates(children),
        ...structuredUnits.map((symbol) => ({
          id: symbol.id,
          path: `${sourcePath}#${symbol.name}`,
          kind: 'xml_unit',
          relation: 'semantic_unit',
          label: symbol.name,
          hint: symbol.signature
        }))
      ],
      parentDirectory: dirId(cleanRepoPath(path.posix.dirname(sourcePath) === '.' ? '' : path.posix.dirname(sourcePath)))
    };
  }

  async inspectFile(sourcePath) {
    const rel = cleanRepoPath(sourcePath);
    const ext = path.posix.extname(rel).toLowerCase();
    if (ext === '.xml' || ext === '.jmx') return this.inspectXmlFile(rel);
    return super.inspectFile(rel);
  }

  async getArtifact(idOrPath) {
    const raw = String(idOrPath || '');
    if (raw.startsWith('xmlnode:')) return this.inspectXmlNode(raw);
    return super.getArtifact(idOrPath);
  }
}
