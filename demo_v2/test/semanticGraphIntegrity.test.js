import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLearnedGraph } from '../server/explorer/mapPersistence.js';
import { graphQueryProjection } from '../server/queryGraphProjection.js';

test('normalizes shadow concepts, duplicate FKs and foreign-owned fields', () => {
  const graph = [
    { id:'entity:order-part', type:'entity', name:'OrderPart', data:{ schemaResolved:true }, links:[
      { nodeId:'field:part-postal', relationship:'has field', cardinality:'one-to-many', data:{ relationshipKind:'schema_field' } },
      { nodeId:'concept:postal', relationship:'postalAddress', cardinality:'one', data:{ relationshipKind:'schema_fk', keyMaps:[{ fieldName:'postalContactMechId', relatedFieldName:'contactMechId', implicit:true }] } },
      { nodeId:'entity:postal', relationship:'postalAddress', cardinality:'one', data:{ relationshipKind:'schema_fk', keyMaps:[{ fieldName:'postalContactMechId', relatedFieldName:'contactMechId', implicit:true }] } }
    ] },
    { id:'entity:postal', type:'entity', name:'PostalAddress', data:{ schemaResolved:true }, links:[
      { nodeId:'field:postal-id', relationship:'has field', cardinality:'one-to-many', data:{ relationshipKind:'schema_field' } }
    ] },
    { id:'field:part-postal', type:'field', name:'OrderPart.postalContactMechId', data:{ entityName:'OrderPart', sourceEntity:'OrderPart', physicalFieldName:'postalContactMechId' }, links:[] },
    { id:'field:postal-id', type:'field', name:'PostalAddress.contactMechId', data:{ entityName:'PostalAddress', sourceEntity:'PostalAddress', physicalFieldName:'contactMechId' }, links:[] },
    { id:'concept:postal', type:'concept', name:'PostalAddress', data:{}, links:[] },
    { id:'entity:business', type:'entity', name:'OrderBillingShippingInfo', data:{ schemaResolved:false }, links:[
      { nodeId:'field:foreign', relationship:'has field', cardinality:'unknown', data:{} }
    ] },
    { id:'field:foreign', type:'field', name:'OrderBillingShippingInfo.OrderItem.quantity', data:{ entityName:'OrderBillingShippingInfo', sourceEntity:'OrderItem', physicalFieldName:'quantity' }, links:[] }
  ];

  const normalized = normalizeLearnedGraph(graph);
  const byId = new Map(normalized.map((node) => [node.id, node]));
  const part = byId.get('entity:order-part');
  const business = byId.get('entity:business');

  assert.equal(normalized.some((node) => node.id === 'concept:postal'), false);
  const postalLink = part.links.find((link) => link.relationship === 'postalAddress');
  assert.equal(part.links.filter((link) => link.relationship === 'postalAddress').length, 1);
  assert.equal(postalLink.nodeId, 'entity:postal');
  assert.equal(postalLink.data.relationshipKind, 'schema_fk');
  assert.deepEqual(postalLink.data.keyMaps, [{ fieldName:'postalContactMechId', relatedFieldName:'contactMechId', implicit:true }]);
  assert.equal(business.links.length, 0);
  assert.equal(normalized.some((node) => node.id === 'field:foreign'), false);
});

test('query projection preserves normalized entity FK navigation', () => {
  const graph = normalizeLearnedGraph([
    { id:'entity:part', type:'entity', name:'OrderPart', data:{ schemaResolved:true }, links:[
      { nodeId:'field:part-postal', relationship:'has field', cardinality:'one-to-many', data:{ relationshipKind:'schema_field' } },
      { nodeId:'entity:postal', relationship:'postalAddress', cardinality:'one', data:{ relationshipKind:'schema_fk', keyMaps:[{ fieldName:'postalContactMechId', relatedFieldName:'contactMechId', implicit:true }] } }
    ] },
    { id:'entity:postal', type:'entity', name:'PostalAddress', data:{ schemaResolved:true }, links:[
      { nodeId:'field:postal-id', relationship:'has field', cardinality:'one-to-many', data:{ relationshipKind:'schema_field' } }
    ] },
    { id:'field:part-postal', type:'field', name:'OrderPart.postalContactMechId', data:{ entityName:'OrderPart', sourceEntity:'OrderPart', physicalFieldName:'postalContactMechId' }, links:[] },
    { id:'field:postal-id', type:'field', name:'PostalAddress.contactMechId', data:{ entityName:'PostalAddress', sourceEntity:'PostalAddress', physicalFieldName:'contactMechId' }, links:[] }
  ]);
  const projection = graphQueryProjection(graph);
  const relation = projection.navigationArcs[0].relationshipDetails[0];
  assert.equal(relation.from, 'OrderPart');
  assert.equal(relation.to, 'PostalAddress');
  assert.equal(relation.relation, 'postalAddress');
  assert.equal(relation.cardinality, 'one');
});
