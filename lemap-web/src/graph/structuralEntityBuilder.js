import { preprocessEntity } from './entityPreprocessor.js';
import { createEntityGraph, findEntity, linkEntities, upsertEntity } from './entityGraph.js';

function arr(value) { return Array.isArray(value) ? value : []; }

function controlStructural(field = {}) {
  return {
    controlType: field.type || 'unknown',
    tag: field.tag || '',
    role: field.role || '',
    domId: field.domId || '',
    name: field.name || '',
    rawType: field.rawType || '',
    href: field.href || '',
    ownerFieldId: field.ownerFieldId || '',
    defaultValue: field.defaultValue ?? null,
    value: field.value ?? null,
    values: [...arr(field.valueDomain)],
    visible: field.visible !== false,
    disabled: !!field.disabled,
    required: !!field.required,
    readonly: !!field.readonly,
    checked: typeof field.checked === 'boolean' ? field.checked : null,
    defaultChecked: typeof field.defaultChecked === 'boolean' ? field.defaultChecked : null,
    placeholder: field.placeholder || '',
    attributes: structuredClone(field.attributes || {})
  };
}

function groupSelectionValue(members = [], flag = 'checked', cardinality = 'exactlyOne') {
  const checkable = arr(members).filter((member) => ['radio', 'checkbox'].includes(member?.type));
  if (!checkable.length) return cardinality === 'zeroOrMore' ? [] : null;
  const selected = checkable.filter((member) => member?.[flag] === true);
  const labels = selected.map((member) => member.label || member.value).filter(Boolean);
  return cardinality === 'zeroOrMore' || cardinality === 'oneOrMore' ? labels : (labels[0] ?? null);
}

export function buildStructuralEntitiesFromPreprocessed(parsed = {}) {
  const graph = createEntityGraph();
  const pageId = parsed.entity?.presentation?.pageId || parsed.entity?.id;
  if (!pageId) return { entities: graph, pageId: '' };

  upsertEntity(graph, {
    id: pageId,
    name: parsed.entity?.label || '',
    type: parsed.entity?.presentation?.overlay ? 'modal' : 'page',
    structural: {
      url: parsed.entity?.presentation?.url || '',
      route: parsed.entity?.presentation?.route || '',
      title: parsed.entity?.presentation?.title || '',
      rootTag: parsed.entity?.presentation?.rootTag || '',
      overlay: !!parsed.entity?.presentation?.overlay
    },
    semantic: {},
    links: []
  });

  const controls = [...arr(parsed.fields), ...arr(parsed.actions)];
  for (const field of controls) {
    upsertEntity(graph, {
      id: field.id,
      name: field.label || field.name || field.id,
      type: 'ui_control',
      structural: controlStructural(field),
      semantic: {},
      links: []
    });
    linkEntities(graph, pageId, field.id, 'contains', 'childOf');
  }

  for (const group of arr(parsed.groups)) {
    const members = arr(group.memberFieldIds)
      .map((id) => controls.find((field) => field.id === id))
      .filter(Boolean);
    const cardinality = group.cardinality || 'exactlyOne';
    upsertEntity(graph, {
      id: group.id,
      name: group.label || 'Choice',
      type: 'group',
      structural: {
        groupType: 'choice',
        cardinality,
        ownerFieldId: group.ownerFieldId || '',
        defaultValue: groupSelectionValue(members, 'defaultChecked', cardinality),
        value: groupSelectionValue(members, 'checked', cardinality),
        values: members.map((member) => member.label || member.value).filter(Boolean),
        visible: members.some((member) => member.visible !== false),
        disabled: members.length > 0 && members.every((member) => !!member.disabled),
        required: members.some((member) => !!member.required)
      },
      semantic: {},
      links: []
    });

    const owner = group.ownerFieldId && findEntity(graph, group.ownerFieldId);
    if (owner) linkEntities(graph, owner.id, group.id, 'contains', 'partOf');
    else linkEntities(graph, pageId, group.id, 'contains', 'childOf');

    for (const member of members) linkEntities(graph, group.id, member.id, 'contains', 'partOf');
  }

  return { entities: graph, pageId };
}

export function buildStructuralEntities(snapshot = {}) {
  return buildStructuralEntitiesFromPreprocessed(preprocessEntity(snapshot));
}
