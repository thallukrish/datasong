import fs from 'node:fs';

const registryUrl = new URL('./patterns.json', import.meta.url);
const registry = JSON.parse(fs.readFileSync(registryUrl, 'utf8'));

function cleanPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function escapeRegexChar(ch) {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}

function selectorRegex(selector = '') {
  const raw = cleanPath(selector);
  let out = '^';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '*' && raw[i + 1] === '*') {
      out += '.*';
      i += 1;
      continue;
    }
    if (ch === '*') {
      out += '[^/]*';
      continue;
    }
    out += escapeRegexChar(ch);
  }
  out += '$';
  return new RegExp(out, 'i');
}

function fileMatches(sourcePath, selectors = []) {
  const rel = cleanPath(sourcePath);
  return selectors.some((selector) => selectorRegex(selector).test(rel));
}

function lineOf(source, index) {
  return String(source || '').slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function selectedRules(options = {}) {
  const ids = Array.isArray(options.ids) ? new Set(options.ids) : null;
  return (Array.isArray(registry.patterns) ? registry.patterns : [])
    .filter((rule) => !ids || ids.has(rule.id));
}

export function odooPatternRules() {
  return (Array.isArray(registry.patterns) ? registry.patterns : []).map((rule) => ({ ...rule }));
}

export function applyOdooPatterns(sourcePath, source, options = {}) {
  const text = String(source || '');
  const matches = [];

  for (const rule of selectedRules(options)) {
    if (!fileMatches(sourcePath, Array.isArray(rule.files) ? rule.files : [])) continue;
    const flags = String(rule.flags || '').includes('g') ? String(rule.flags || '') : `${rule.flags || ''}g`;
    let regex;
    try {
      regex = new RegExp(rule.regex, flags);
    } catch (error) {
      throw new Error(`Invalid Odoo pattern ${rule.id}: ${error.message}`);
    }

    let match;
    while ((match = regex.exec(text))) {
      const captures = {};
      for (const [name, index] of Object.entries(rule.captures || {})) {
        captures[name] = match[Number(index)] ?? '';
      }
      matches.push({
        ruleId: rule.id,
        sourcePath: cleanPath(sourcePath),
        line: lineOf(text, match.index || 0),
        index: match.index || 0,
        match: match[0],
        captures,
        emit: { ...(rule.emit || {}) }
      });
      if (match[0] === '') regex.lastIndex += 1;
    }
  }

  return matches;
}

export { fileMatches };
