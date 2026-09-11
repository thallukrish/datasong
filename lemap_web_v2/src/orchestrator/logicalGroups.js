import crypto from 'node:crypto';

const EXPLICIT_GROUP_TAGS = new Set(['fieldset', 'mat-radio-group']);
const SUPPORTED_CONTROL_TYPES = new Set(['radio', 'checkbox']);

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

function addLink(entity, link) {
  if (!Array.isArray(entity.links)) entity.links = [];
  const exists = entity.links.some((candidate) => (
    candidate.id === link.id && candidate.relationship === link.relationship
  ));
  if (!exists) entity.links.push(link);
}

function childIds(entity) {
  return (Array.isArray(entity?.links) ? entity.links : [])
    .filter((link) => link.relationship === 'contains')
    .map((link) => link.id);
}

function descendantControls(owner, byId) {
  const controls = [];
  const visit = (entity) => {
    for (const childId of childIds(entity)) {
      const child = byId.get(childId);
      if (!child) continue;
      if (child.type === 'ui_control' && SUPPORTED_CONTROL_TYPES.has(child.structural?.controlType)) {
        controls.push(child);
        continue;
      }
      if (child.type === 'ui_group') continue;
      visit(child);
    }
  };
  visit(owner);
  return controls;
}

function candidatesForOwner(owner, byId) {
  const explicit = EXPLICIT_GROUP_TAGS.has(clean(owner?.structural?.tag).toLowerCase());
  const controls = explicit
    ? descendantControls(owner, byId)
    : childIds(owner).map((id) => byId.get(id)).filter((entity) => (
        entity?.type === 'ui_control' && SUPPORTED_CONTROL_TYPES.has(entity.structural?.controlType)
      ));

  const buckets = new Map();
  for (const control of controls) {
    const controlType = clean(control.structural?.controlType);
    const name = clean(control.structural?.name);
    if (!explicit && !name) continue;
    const key = explicit
      ? `${controlType}|${name || '__explicit__'}`
      : `${controlType}|${name}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(control);
  }

  return [...buckets.values()].filter((members) => members.length >= 2);
}

function groupName(owner, members) {
  const ownerName = clean(owner?.name);
  if (ownerName && ownerName !== clean(owner?.structural?.tag)) return ownerName;
  const sharedName = clean(members[0]?.structural?.name);
  return sharedName || `${clean(members[0]?.structural?.controlType) || 'choice'} group`;
}

function createGroup(owner, members) {
  const controlType = clean(members[0]?.structural?.controlType);
  const memberIds = members.map((member) => member.id);
  const stableKey = `${owner.id}|${controlType}|${clean(members[0]?.structural?.name)}|${memberIds.join('|')}`;
  return {
    id: `group:${hash(stableKey)}`,
    type: 'ui_group',
    name: groupName(owner, members),
    structural: {
      groupType: 'choice',
      controlType,
      cardinality: controlType === 'radio' ? 'exactlyOne' : 'zeroOrMore',
      ownerId: owner.id,
      memberIds
    },
    semantic: {},
    links: []
  };
}

export function inferLogicalGroups({ page, entities = [] } = {}) {
  if (!page?.id) throw new Error('A page entity is required.');
  if (!Array.isArray(entities)) throw new Error('entities must be an array.');

  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  if (!byId.has(page.id)) throw new Error(`Page entity ${page.id} is missing from entities.`);

  const existingGroups = entities.filter((entity) => entity.type === 'ui_group');
  const groupsById = new Map(existingGroups.map((group) => [group.id, group]));
  const owners = entities.filter((entity) => entity.type === 'page' || entity.type === 'container');

  for (const owner of owners) {
    for (const members of candidatesForOwner(owner, byId)) {
      const proposed = createGroup(owner, members);
      const group = groupsById.get(proposed.id) || proposed;

      if (!groupsById.has(group.id)) {
        entities.push(group);
        byId.set(group.id, group);
        groupsById.set(group.id, group);
      }

      addLink(owner, { id: group.id, relationship: 'hasGroup' });
      addLink(group, { id: owner.id, relationship: 'ownedBy' });

      for (const member of members) {
        addLink(group, { id: member.id, relationship: 'hasMember' });
        addLink(member, { id: group.id, relationship: 'memberOf' });
      }
    }
  }

  const groups = [...groupsById.values()];
  return { page: byId.get(page.id), entities, groups, byId };
}
