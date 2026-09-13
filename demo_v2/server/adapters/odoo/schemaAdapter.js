import fs from 'node:fs/promises';
import path from 'node:path';
import { extractOdooModels } from './modelParser.js';

function addonForPath(sourcePath, addons = []) {
  const parts = String(sourcePath || '').split('/');
  for (const addon of addons) {
    if (parts.includes(addon?.name)) return addon.name;
  }
  return '';
}

export class OdooEntitySchemaAdapter {
  constructor(topology) {
    this.topology = topology;
  }

  async augment() {
    const topology = this.topology;
    const version = String(topology?.odooDetection?.version || '');
    const addons = Array.isArray(topology?.odooDetection?.addons) ? topology.odooDetection.addons : [];
    const trackedFiles = Array.isArray(topology?.trackedFiles) ? topology.trackedFiles : [];
    const repoDir = topology?.repoDir || '';
    const schemas = [];

    for (const sourcePath of trackedFiles.filter((file) => /(?:^|\/)models\/.*\.py$/.test(file))) {
      const addon = addonForPath(sourcePath, addons);
      if (!addon) continue;
      const source = await fs.readFile(path.join(repoDir, sourcePath), 'utf8');
      for (const model of extractOdooModels(sourcePath, source, addon)) {
        const stableId = `odoo${version}:model:${model.name}`;
        const schema = {
          name: model.name,
          fullName: model.name,
          fields: model.fields,
          relationships: model.fields
            .filter((field) => field.relatedModel)
            .map((field) => ({
              type: field.relation,
              relatedEntityName: field.relatedModel,
              title: field.name,
              keyMaps: []
            })),
          stableId,
          framework: 'odoo',
          frameworkVersion: version,
          ownership: model.extension ? 'project-extension' : 'project',
          extensionOf: model.extension ? stableId : '',
          provenance: {
            sourcePath: model.sourcePath,
            addon: model.addon,
            layer: 'project'
          }
        };
        schemas.push(schema);
      }
    }

    topology.entitySchemas = schemas;
    topology.entitySchemaByName = new Map();
    for (const schema of schemas) {
      topology.entitySchemaByName.set(schema.name, schema);
      topology.entitySchemaByName.set(schema.fullName, schema);
    }

    return { adapter: 'odoo-entity-schema-v1', version, schemaCount: schemas.length, schemas };
  }
}
