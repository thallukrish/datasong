const RELATION_BY_TYPE = {
  Many2one: 'many-to-one',
  One2many: 'one-to-many',
  Many2many: 'many-to-many'
};

const stringLiterals = (text) => [...text.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
const pickBool = (text, key) => new RegExp(`\\b${key}\\s*=\\s*True\\b`).test(text);
const pickStringArg = (text, key) => {
  const m = text.match(new RegExp(`\\b${key}\\s*=\\s*["']([^"']+)["']`));
  return m ? m[1] : '';
};

function collectFieldCall(lines, startIndex) {
  let text = lines[startIndex];
  let depth = 0;
  let seenParen = false;
  const count = (line) => {
    for (const ch of line) {
      if (ch === '(') { depth += 1; seenParen = true; }
      else if (ch === ')') depth -= 1;
    }
  };
  count(text);
  let endIndex = startIndex;
  while (seenParen && depth > 0 && endIndex + 1 < lines.length) {
    endIndex += 1;
    text += `\n${lines[endIndex]}`;
    count(lines[endIndex]);
  }
  return { text, endIndex };
}

export function extractOdooModels(sourcePath, source, addonName) {
  const classMatches = [...source.matchAll(/^class\s+([A-Za-z_]\w*)\s*\([^\n]*models\.[A-Za-z_]\w*[^\n]*\)\s*:\s*$/gm)];
  const models = [];

  for (let i = 0; i < classMatches.length; i += 1) {
    const match = classMatches[i];
    const className = match[1];
    const start = match.index + match[0].length;
    const end = i + 1 < classMatches.length ? classMatches[i + 1].index : source.length;
    const block = source.slice(start, end);

    const nameMatch = block.match(/^\s+_name\s*=\s*["']([^"']+)["']/m);
    const inheritListMatch = block.match(/^\s+_inherit\s*=\s*\[([\s\S]*?)\]/m);
    const inheritStringMatch = block.match(/^\s+_inherit\s*=\s*["']([^"']+)["']/m);
    const inherits = inheritListMatch
      ? stringLiterals(inheritListMatch[1])
      : inheritStringMatch ? [inheritStringMatch[1]] : [];
    const explicitName = nameMatch ? nameMatch[1] : '';
    const name = explicitName || (inherits.length === 1 ? inherits[0] : '');
    if (!name) continue;

    const lines = block.split('\n');
    const fields = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const fieldMatch = line.match(/^\s+([A-Za-z_]\w*)\s*=\s*fields\.([A-Za-z_]\w*)\s*\(/);
      if (!fieldMatch) continue;
      const { text, endIndex } = collectFieldCall(lines, lineIndex);
      const [, fieldName, type] = fieldMatch;
      const literals = stringLiterals(text.slice(text.indexOf('(') + 1));
      const relatedModel = RELATION_BY_TYPE[type] ? (literals[0] || '') : '';
      fields.push({
        name: fieldName,
        type,
        relatedModel,
        relation: RELATION_BY_TYPE[type] || '',
        required: pickBool(text, 'required'),
        readonly: pickBool(text, 'readonly'),
        string: pickStringArg(text, 'string'),
        sourceLine: source.slice(0, start).split('\n').length + lineIndex
      });
      lineIndex = endIndex;
    }

    models.push({
      className,
      name,
      inherits,
      extension: !explicitName && inherits.length === 1,
      sourcePath,
      addon: addonName,
      fields
    });
  }

  return models;
}
