const lineOf = (source, index) => source.slice(0, Math.max(0, index)).split('\n').length;

function records(xml) {
  return [...String(xml || '').matchAll(/<record\b[^>]*\bmodel=["']([^"']+)["'][^>]*>([\s\S]*?)<\/record>/g)]
    .map((match) => {
      const index = match.index || 0;
      const bodyOffset = match[0].indexOf(match[2]);
      return {
        model: match[1],
        body: match[2],
        index,
        bodyIndex: index + Math.max(0, bodyOffset)
      };
    });
}

function fieldValue(body, name) {
  const match = body.match(new RegExp(`<field\\b[^>]*\\bname=["']${name}["'][^>]*>([\\s\\S]*?)<\\/field>`, 'i'));
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

function unique(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind || item.actionType}|${item.modelName}|${item.methodName || ''}|${item.sourcePath}|${item.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractOdooUiEntrypoints(sourcePath, xml) {
  const source = String(xml || '');
  const entrypoints = [];
  const modelActions = [];

  for (const record of records(source)) {
    if (record.model === 'ir.ui.view') {
      const modelName = fieldValue(record.body, 'model');
      if (!modelName) continue;
      for (const button of record.body.matchAll(/<button\b([^>]*)>/gi)) {
        const attrs = button[1] || '';
        const type = attrs.match(/\btype=["']([^"']+)["']/i)?.[1] || '';
        const methodName = attrs.match(/\bname=["']([^"']+)["']/i)?.[1] || '';
        if (type !== 'object' || !methodName) continue;
        const absoluteIndex = record.bodyIndex + (button.index || 0);
        entrypoints.push({
          kind: 'object_button', modelName, methodName, sourcePath,
          line: lineOf(source, absoluteIndex)
        });
      }
      continue;
    }

    if (record.model === 'ir.actions.act_window') {
      const modelName = fieldValue(record.body, 'res_model');
      if (modelName) modelActions.push({
        modelName, actionType: 'act_window', sourcePath,
        line: lineOf(source, record.index)
      });
      continue;
    }

    if (record.model === 'ir.actions.server') {
      const modelName = fieldValue(record.body, 'model_name') || fieldValue(record.body, 'res_model');
      const code = fieldValue(record.body, 'code');
      if (!modelName || !code) continue;
      for (const call of code.matchAll(/\b(?:records?|model)\.([A-Za-z_]\w*)\s*\(/g)) {
        entrypoints.push({
          kind: 'server_action', modelName, methodName: call[1], sourcePath,
          line: lineOf(source, record.index)
        });
      }
    }
  }

  return { entrypoints: unique(entrypoints), modelActions: unique(modelActions) };
}
