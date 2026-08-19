import fs from 'node:fs/promises';
import path from 'node:path';

const EXEC_TAGS = new Set([
  'screen', 'transition', 'transition-include', 'actions', 'condition', 'if', 'else', 'iterate',
  'service-call', 'entity-find', 'entity-find-count', 'entity-one', 'entity-create', 'entity-update',
  'entity-delete', 'set', 'script', 'default-response', 'conditional-response', 'error-response',
  'subscreens-item'
]);

function clean(value = '') { return String(value || '').trim(); }
function attr(raw, name) {
  const match = String(raw || '').match(new RegExp(`\\b${name}=["']([^"']+)["']`));
  return match ? match[1] : '';
}
function lineAt(text, offset) { return text.slice(0, offset).split(/\r?\n/).length; }
function leaf(value = '') {
  const parts = clean(value).replace(/\\/g, '/').split('/').filter(Boolean);
  return (parts.at(-1) || '').replace(/\.xml$/i, '');
}
function compactTag(raw = '') { return clean(raw).replace(/\s+/g, ' ').slice(0, 320); }
function flowName(sourcePath, ordinal, tag, identity) {
  const safe = clean(identity || `${tag}-${ordinal}`).replace(/\s+/g, ' ').slice(0, 120);
  return `$moqui.${sourcePath}.${String(ordinal).padStart(4, '0')}.${tag}.${safe}`;
}

export function extractMoquiXmlExecution(sourcePath, xml) {
  const nodes = [];
  const stack = [];
  const tagRe = /<([^>]+)>/g;
  let match;

  while ((match = tagRe.exec(xml))) {
    const token = clean(match[1]);
    if (!token || token.startsWith('?') || token.startsWith('!')) continue;
    if (token.startsWith('/')) {
      const closing = token.slice(1).trim().split(/\s+/)[0].split(':').at(-1);
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === closing) { stack.splice(i); break; }
      }
      continue;
    }

    const selfClosing = /\/\s*$/.test(token);
    const open = token.replace(/\/\s*$/, '').trim();
    const rawTag = open.split(/\s+/)[0];
    const tag = rawTag.split(':').at(-1);
    const parentExec = [...stack].reverse().find((entry) => entry.exec)?.exec || null;
    let exec = null;

    if (EXEC_TAGS.has(tag)) {
      const raw = `<${open}${selfClosing ? '/' : ''}>`;
      const identity = attr(raw, 'name') || attr(raw, 'entity-name') || attr(raw, 'url') || attr(raw, 'location') || attr(raw, 'field') || attr(raw, 'field-name') || '';
      exec = {
        ordinal: nodes.length + 1,
        tag,
        line: lineAt(xml, match.index),
        raw: compactTag(raw),
        identity,
        parentOrdinal: parentExec?.ordinal || null,
        attrs: {
          name: attr(raw, 'name'),
          entityName: attr(raw, 'entity-name'),
          url: attr(raw, 'url'),
          location: attr(raw, 'location'),
          field: attr(raw, 'field') || attr(raw, 'field-name'),
          condition: attr(raw, 'condition')
        }
      };
      nodes.push(exec);
    }

    if (!selfClosing) stack.push({ tag, exec });
  }

  return nodes;
}

export class MoquiXmlExecutionAdapter {
  constructor(topology) { this.topology = topology; }

  async augment() {
    const tracked = Array.isArray(this.topology?.trackedFiles) ? this.topology.trackedFiles : [];
    const xmlFiles = tracked.filter((file) => /(?:^|\/)screen\/.*\.xml$/i.test(file) || /(?:^|\/)screen[^/]*\.xml$/i.test(file));
    const createdByFile = new Map();

    for (const sourcePath of xmlFiles) {
      const xml = await fs.readFile(path.join(this.topology.repoDir, sourcePath), 'utf8').catch(() => '');
      if (!xml || !/<screen\b/i.test(xml)) continue;
      const parsed = extractMoquiXmlExecution(sourcePath, xml);
      const symbols = [];
      for (const node of parsed) {
        const name = flowName(sourcePath, node.ordinal, node.tag, node.identity);
        const symbol = this.topology.addSemanticFunction({
          sourcePath,
          name,
          symbolKind: `moqui_${node.tag.replace(/-/g, '_')}`,
          semanticType: 'moqui_executable_xml',
          line: node.line,
          signature: node.raw,
          body: ''
        });
        symbol.moquiXmlNode = node;
        symbols.push(symbol);
      }
      createdByFile.set(sourcePath, symbols);
    }

    this.topology.reindexAllSymbols();

    const screenRootByFile = new Map();
    for (const [sourcePath, symbols] of createdByFile) {
      const root = symbols.find((symbol) => symbol.moquiXmlNode?.tag === 'screen');
      if (root) screenRootByFile.set(sourcePath, root);
    }

    for (const [sourcePath, symbols] of createdByFile) {
      const byOrdinal = new Map(symbols.map((symbol) => [symbol.moquiXmlNode.ordinal, symbol]));
      const children = new Map();
      for (const symbol of symbols) {
        const parent = symbol.moquiXmlNode.parentOrdinal;
        if (parent == null) continue;
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(symbol);
      }

      for (const [parentOrdinal, childSymbols] of children) {
        const parent = byOrdinal.get(parentOrdinal);
        if (!parent || !childSymbols.length) continue;
        const ordered = [...childSymbols].sort((a, b) => a.moquiXmlNode.ordinal - b.moquiXmlNode.ordinal);

        // A screen is a container of alternate transitions/subscreens, not a
        // sequential program. Each direct executable child is an independent entrance.
        if (parent.moquiXmlNode.tag === 'screen') {
          for (const child of ordered) this.addRef(parent, child, 'routes_to');
          continue;
        }

        this.addRef(parent, ordered[0], 'calls');

        // Conditional containers branch. Other executable containers preserve
        // document order, which is the deterministic action order in Moqui XML.
        if (['if', 'condition'].includes(parent.moquiXmlNode.tag)) {
          for (const branch of ordered.slice(1)) this.addRef(parent, branch, 'calls');
        } else {
          for (let i = 0; i < ordered.length - 1; i += 1) this.addRef(ordered[i], ordered[i + 1], 'returns_to');
        }
      }

      for (const symbol of symbols) {
        const node = symbol.moquiXmlNode;
        if (node.tag === 'service-call' && node.attrs.name) {
          symbol.references.push({ name: node.attrs.name, simpleName: node.attrs.name.split(/[.#:/]/).at(-1), relation: 'calls', explicit: true });
        }
        if (['entity-find', 'entity-find-count', 'entity-one'].includes(node.tag) && node.attrs.entityName) {
          symbol.references.push({ name: node.attrs.entityName, simpleName: node.attrs.entityName.split(/[.#:/]/).at(-1), relation: 'reads', explicit: true });
        }
        if (['entity-create', 'entity-update', 'entity-delete'].includes(node.tag) && node.attrs.entityName) {
          symbol.references.push({ name: node.attrs.entityName, simpleName: node.attrs.entityName.split(/[.#:/]/).at(-1), relation: 'writes', explicit: true });
        }
        if (['default-response', 'conditional-response', 'error-response'].includes(node.tag) && node.attrs.url) {
          const target = this.resolveScreenTarget(sourcePath, node.attrs.url, screenRootByFile);
          if (target) this.addRef(symbol, target, 'routes_to');
        }
      }
    }

    this.topology.reindexAllSymbols();
    this.topology.rebuildCallers();
    return {
      adapter: 'moqui-screen-xml-v1',
      files: createdByFile.size,
      nodes: [...createdByFile.values()].reduce((sum, symbols) => sum + symbols.length, 0)
    };
  }

  addRef(from, to, relation) {
    if (!from || !to || from.id === to.id) return;
    if (!Array.isArray(from.references)) from.references = [];
    const exists = from.references.some((ref) => ref.relation === relation && ref.name === to.name);
    if (!exists) from.references.push({ name: to.name, simpleName: to.simpleName || to.name, relation, explicit: true });
  }

  resolveScreenTarget(sourcePath, rawUrl, roots) {
    const url = clean(rawUrl).split(/[?#]/)[0];
    if (!url || /\$\{|^https?:|^mailto:|^#/.test(url)) return null;
    const normalized = url.replace(/^\/+/, '').replace(/\\/g, '/');
    const sourceDir = path.posix.dirname(sourcePath);
    const candidates = new Set();
    const withXml = normalized.endsWith('.xml') ? normalized : `${normalized}.xml`;
    candidates.add(path.posix.normalize(path.posix.join(sourceDir, withXml)));
    candidates.add(path.posix.normalize(path.posix.join('screen', withXml)));
    for (const candidate of candidates) if (roots.has(candidate)) return roots.get(candidate);

    const wanted = leaf(normalized).toLowerCase();
    if (!wanted) return null;
    const basenameMatches = [...roots.entries()].filter(([file]) => leaf(file).toLowerCase() === wanted);
    return basenameMatches.length === 1 ? basenameMatches[0][1] : null;
  }
}
