import fs from 'node:fs';
import path from 'node:path';

const clone = (value) => JSON.parse(JSON.stringify(value));

export class OdooFrameworkMapStore {
  constructor({ dataRoot, version }) {
    this.dataRoot = dataRoot;
    this.version = String(version || '');
  }

  directory() {
    return path.join(this.dataRoot, 'semantic-maps', 'frameworks', 'odoo', this.version);
  }

  filePath() {
    return path.join(this.directory(), 'map.json');
  }

  emptyMap() {
    return {
      version: 1,
      framework: 'odoo',
      frameworkVersion: this.version,
      updatedAt: '',
      sources: [],
      schemas: {}
    };
  }

  load() {
    const file = this.filePath();
    if (!fs.existsSync(file)) return this.emptyMap();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      ...this.emptyMap(),
      ...parsed,
      sources: Array.isArray(parsed?.sources) ? parsed.sources : [],
      schemas: parsed?.schemas && typeof parsed.schemas === 'object' ? parsed.schemas : {}
    };
  }

  save(map) {
    const dir = this.directory();
    const file = this.filePath();
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const backup = `${file}.bak`;
    fs.mkdirSync(dir, { recursive: true });
    const payload = { ...clone(map), updatedAt: new Date().toISOString() };
    try {
      fs.writeFileSync(temp, JSON.stringify(payload, null, 2));
      JSON.parse(fs.readFileSync(temp, 'utf8'));
      if (fs.existsSync(file)) {
        try {
          JSON.parse(fs.readFileSync(file, 'utf8'));
          fs.copyFileSync(file, backup);
        } catch {}
        fs.rmSync(file, { force: true });
      }
      fs.renameSync(temp, file);
    } finally {
      if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
    }
    return payload;
  }

  mergeSchemas({ source, schemas = [] }) {
    const map = this.load();
    const sourceRecord = {
      repoUrl: String(source?.repoUrl || ''),
      commit: String(source?.commit || '')
    };
    const sourceKey = `${sourceRecord.repoUrl}@${sourceRecord.commit}`;
    if (sourceKey !== '@') {
      const seen = new Set(map.sources.map((item) => `${item?.repoUrl || ''}@${item?.commit || ''}`));
      if (!seen.has(sourceKey)) map.sources.push(sourceRecord);
    }
    for (const schema of Array.isArray(schemas) ? schemas : []) {
      if (!schema?.stableId) continue;
      map.schemas[schema.stableId] = clone(schema);
    }
    return this.save(map);
  }
}
