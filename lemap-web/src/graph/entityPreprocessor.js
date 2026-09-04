import { buildEntityIdentity } from './entityIdentity.js';
import { buildEntityHierarchy } from './entityHierarchy.js';
import { discoverInputs } from '../preprocess/inputDiscovery.js';
import { discoverGroups } from '../preprocess/groupDiscovery.js';
import { scannerFor } from '../preprocess/scanners/registry.js';

export function preprocessEntity(snapshot = {}) {
  const root = snapshot.dom || {};
  const entity = buildEntityIdentity(snapshot, root);
  const controls = discoverInputs(root, entity.id);
  const groups = discoverGroups(controls, entity.id);
  const fields = controls.filter((control) => !['button', 'link'].includes(control.type));
  const actions = controls.filter((control) => ['button', 'link'].includes(control.type));
  const hierarchy = buildEntityHierarchy(controls, entity);
  const methods = controls.map((field) => ({
    fieldId: field.id,
    fieldLabel: field.label,
    fieldType: field.type,
    groupId: field.parentGroupId || '',
    executableNow: field.visible && !field.disabled && field.type !== 'file',
    actions: scannerFor(field).actions(field)
  }));
  const relationships = groups.map((group) => ({
    id: `relationship:${group.id}`,
    entityId: entity.id,
    kind: 'group_membership',
    groupId: group.id,
    memberFieldIds: [...group.memberFieldIds],
    evidence: { structural: true, label: group.label, groupType: group.groupType }
  }));
  return { version: 2, entity, hierarchy, fields, actions, groups, relationships, methods };
}
