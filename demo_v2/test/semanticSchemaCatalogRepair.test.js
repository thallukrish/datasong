import test from 'node:test';
import assert from 'node:assert/strict';
import { withSemanticModel } from '../server/explorer/semanticModel.js';

class BaseExplorer {
  constructor({ topology, state }) {
    this.topology = topology;
    this.state = state;
    this.persistCalls = 0;
  }
  persistSemanticMap() {
    this.persistCalls += 1;
    return { ok: true };
  }
}

const SemanticExplorer = withSemanticModel(BaseExplorer);

test('persist repairs missing schema catalog nodes without replacing learned workflow objects', () => {
  const workflow = {
    id: 'workflow:existing',
    type: 'workflow',
    name: 'Existing Checkout Workflow',
    aliases: [],
    scope: 'arc-1',
    properties: { arcId: 'arc-1', closureState: 'closed' },
    evidence: [{ sourceType: 'call_path', source: 'callpath:1', strength: 0.88, assertion: 'Existing learned workflow evidence.' }],
    confidence: 0.88
  };
  const state = {
    repoUrl: 'https://github.com/moqui/PopCommerce',
    commit: 'abc123',
    pass1Arcs: [],
    semanticObjects: { [workflow.id]: workflow }
  };
  const topology = {
    entitySchemas: [
      {
        name: 'Facility',
        fullName: 'mantle.facility.Facility',
        sourcePath: 'dependency/mantle-udm/entity/FacilityEntities.xml',
        component: 'mantle-udm',
        description: '',
        fields: [{ name: 'facilityId', type: 'id', isPk: true }, { name: 'geoId', type: 'id', isPk: false }],
        relationships: [{ type: 'one', relatedEntityName: 'moqui.basic.Geo', title: 'Geo', shortAlias: 'geo', keyMaps: [{ fieldName: 'geoId', relatedFieldName: '' }] }]
      },
      {
        name: 'Geo',
        fullName: 'moqui.basic.Geo',
        sourcePath: 'framework-repo/framework/entity/BasicEntities.xml',
        component: 'moqui-framework',
        description: '',
        fields: [{ name: 'geoId', type: 'id', isPk: true }],
        relationships: []
      }
    ]
  };
  const explorer = new SemanticExplorer({ topology, state });
  explorer.schemaRelationshipDetails = (name) => name === 'Facility' ? [{
    from: 'Facility', relation: 'Geo', to: 'Geo',
    description: 'Schema-defined entity relationship. Join: Facility.geoId = Geo.geoId.',
    relationshipKind: 'schema_fk', schemaRelationshipType: 'one',
    keyMaps: [{ fieldName: 'geoId', relatedFieldName: 'geoId', implicit: true }],
    sourceSchema: 'mantle.facility.Facility', targetSchema: 'moqui.basic.Geo',
    schemaSourcePath: 'dependency/mantle-udm/entity/FacilityEntities.xml', evidenced: true
  }] : [];

  explorer.persistSemanticMap();

  assert.equal(state.semanticObjects['workflow:existing'], workflow);
  assert.equal(state.semanticObjects['workflow:existing'].evidence[0].source, 'callpath:1');

  const objects = Object.values(state.semanticObjects);
  const facility = objects.find((object) => object.type === 'entity' && object.name === 'Facility');
  const geo = objects.find((object) => object.type === 'entity' && object.name === 'Geo');
  assert.ok(facility);
  assert.ok(geo);
  assert.equal(geo.properties.schemaName, 'moqui.basic.Geo');
  assert.equal(geo.properties.schemaComponent, 'moqui-framework');

  const relation = objects.find((object) => object.type === 'relation'
    && object.properties?.fromId === facility.id
    && object.properties?.toId === geo.id
    && object.properties?.relationshipKind === 'schema_fk');
  assert.ok(relation);
  assert.deepEqual(relation.properties.keyMaps, [{ fieldName: 'geoId', relatedFieldName: 'geoId', implicit: true }]);
  assert.equal(explorer.persistCalls, 1);

  const objectCount = Object.keys(state.semanticObjects).length;
  explorer.persistSemanticMap();
  assert.equal(Object.keys(state.semanticObjects).length, objectCount);
  assert.equal(state.semanticObjects['workflow:existing'], workflow);
});
