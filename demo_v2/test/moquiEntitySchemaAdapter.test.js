import test from 'node:test';
import assert from 'node:assert/strict';
import { MoquiEntitySchemaAdapter } from '../server/moquiEntitySchemaAdapter.js';

test('Moqui schema adapter includes framework entities in the global schema catalog', async () => {
  const topology = {
    repoDir: '/unused/local',
    cacheRoot: '/unused/cache',
    trackedFiles: [],
    entitySchemas: [],
    entitySchemaByName: new Map()
  };
  const adapter = new MoquiEntitySchemaAdapter(topology);

  adapter.frameworkRoot = async () => ({ name: 'moqui-framework', dir: '/framework' });
  adapter.dependencyRoots = async () => [];
  adapter.schemasFromRoot = async (rootDir, component, prefix, includeFile = () => true) => {
    assert.equal(rootDir, '/framework');
    assert.equal(component, 'moqui-framework');
    assert.equal(prefix, 'framework-repo/');
    assert.equal(includeFile('framework/entity/BasicEntities.xml'), true);
    assert.equal(includeFile('framework/service/org/moqui/impl/BasicServices.xml'), false);
    return [{
      name: 'Geo',
      fullName: 'moqui.basic.Geo',
      packageName: 'moqui.basic',
      description: '',
      sourcePath: 'framework-repo/framework/entity/BasicEntities.xml',
      component: 'moqui-framework',
      fields: [{ name: 'geoId', type: 'id', isPk: true }],
      relationships: [{
        type: 'many',
        relatedEntityName: 'moqui.basic.GeoAssoc',
        title: '',
        shortAlias: 'assocs',
        keyMaps: [{ fieldName: 'geoId', relatedFieldName: '' }]
      }],
      definitionKind: 'entity'
    }];
  };

  const result = await adapter.augment();

  assert.equal(topology.entitySchemaByName.get('Geo')?.fullName, 'moqui.basic.Geo');
  assert.equal(topology.entitySchemaByName.get('moqui.basic.Geo')?.component, 'moqui-framework');
  assert.equal(result.frameworkComponent, 'moqui-framework');
  assert.equal(result.frameworkEntities, 1);
});
