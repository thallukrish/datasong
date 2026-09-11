import { createAdapterRegistry } from '../adapters/adapterRegistry.js';
import { angularMaterialAdapter } from '../adapters/angularMaterialAdapter.js';
import { nativeControlAdapter } from '../adapters/nativeControlAdapter.js';
import { ariaControlAdapter } from '../adapters/ariaControlAdapter.js';
import { createPageEntity, createStructuralEntity } from '../entity/canonicalEntity.js';

export function createDefaultAdapterRegistry() {
  return createAdapterRegistry([
    angularMaterialAdapter,
    nativeControlAdapter,
    ariaControlAdapter
  ]);
}

export function orchestratePage(snapshot = {}, { registry = createDefaultAdapterRegistry() } = {}) {
  if (!snapshot?.root?.tag) throw new Error('Snapshot root is required.');
  if (!registry?.parse) throw new Error('An adapter registry with parse() is required.');

  const page = createPageEntity(snapshot);
  const entities = [page];
  const hierarchy = [];

  const visit = (node, path, parentId) => {
    const parsedControl = registry.parse(node, { snapshot, page, path });
    const entity = createStructuralEntity({
      pageId: page.id,
      path,
      node,
      parsedControl
    });

    entities.push(entity);
    hierarchy.push({ parentId, childId: entity.id });

    const children = Array.isArray(node.children) ? node.children : [];
    children.forEach((child, index) => visit(child, [...path, index], entity.id));
  };

  visit(snapshot.root, [], page.id);

  return { page, entities, hierarchy };
}
