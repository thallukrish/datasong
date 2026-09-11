import { findEntity, linkEntities } from '../graph/entityGraph.js';

const NAVIGATION_CONTROL_TYPES = new Set(['link', 'button']);

export function registerNavigationEntity(graph, entityId) {
  const entity = findEntity(graph, entityId);
  if (!entity) throw new Error(`Unknown navigation entity: ${entityId}`);
  if (entity.type !== 'ui_control') {
    throw new Error(`Navigation entity ${entityId} must be a ui_control.`);
  }

  const controlType = String(entity.structural?.controlType || '');
  if (!NAVIGATION_CONTROL_TYPES.has(controlType)) {
    throw new Error(`Navigation entity ${entityId} must be a link or button control.`);
  }

  entity.structural = {
    ...(entity.structural || {}),
    navigation: true,
    navigationKind: controlType
  };
  return entity;
}

export function resolveNavigationDestination(graph, navigationEntityId, destinationPageId) {
  const destination = findEntity(graph, destinationPageId);
  if (!destination || destination.type !== 'page') {
    throw new Error(`Unknown destination page: ${destinationPageId}`);
  }

  const navigation = registerNavigationEntity(graph, navigationEntityId);
  linkEntities(graph, navigation.id, destination.id, 'transitionsTo', {
    reverseRelationship: 'enteredVia'
  });

  return { navigation, destination };
}
