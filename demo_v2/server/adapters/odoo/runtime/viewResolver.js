function arr(value) { return Array.isArray(value) ? value : []; }

function recordBodies(xml = '') {
  return [...String(xml).matchAll(/<record\b([^>]*)\bmodel=["']ir\.ui\.view["']([^>]*)>([\s\S]*?)<\/record>/gi)]
    .map((match) => ({ attrs: `${match[1] || ''} ${match[2] || ''}`, body: match[3] || '' }));
}

function attr(text, name) {
  const match = String(text || '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function field(body, name) {
  const match = String(body || '').match(new RegExp(`<field\\b[^>]*\\bname=["']${name}["'][^>]*>([\\s\\S]*?)<\\/field>`, 'i'));
  return match ? match[1].replace(/<[^>]+>/g, '').trim() : '';
}

export function extractOdooClickableActions(sourcePath, xml) {
  const actions = [];
  for (const record of recordBodies(xml)) {
    const modelName = field(record.body, 'model');
    if (!modelName) continue;
    const xmlId = attr(record.attrs, 'id');
    for (const match of String(record.body).matchAll(/<button\b([^>]*)>/gi)) {
      const attrs = match[1] || '';
      if (attr(attrs, 'type') !== 'object') continue;
      const methodName = attr(attrs, 'name');
      if (!methodName) continue;
      actions.push({
        modelName,
        methodName,
        label: attr(attrs, 'string'),
        xmlId,
        sourcePath
      });
    }
  }
  return actions;
}

export class OdooXmlUiResolver {
  constructor(actions = []) {
    this.actions = arr(actions);
  }

  static fromSources(sources = []) {
    return new OdooXmlUiResolver(
      arr(sources).flatMap((source) => extractOdooClickableActions(source.sourcePath, source.xml))
    );
  }

  async resolveClick({ model, label = '', xmlId = '' }) {
    const wantedModel = String(model || '');
    const wantedLabel = String(label || '').trim().toLowerCase();
    const wantedXmlId = String(xmlId || '').trim();
    const candidates = this.actions.filter((action) => action.modelName === wantedModel);
    if (wantedXmlId) {
      const exactId = candidates.find((action) => action.xmlId === wantedXmlId);
      if (exactId) return exactId;
    }
    if (wantedLabel) {
      const exactLabel = candidates.find((action) => String(action.label || '').trim().toLowerCase() === wantedLabel);
      if (exactLabel) return exactLabel;
    }
    return null;
  }
}
