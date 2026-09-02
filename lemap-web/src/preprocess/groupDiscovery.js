import crypto from 'node:crypto';
function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }

export function discoverGroups(fields = [], entityId = '') {
  const groups = [];
  const buckets = new Map();
  for (const field of fields) {
    if (!['radio', 'checkbox'].includes(field.type)) continue;
    const key = field.type === 'radio'
      ? `radio|${field.name || field.parentRegionLabel}`
      : `checkbox|${field.parentRegionLabel}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(field);
  }
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const groupType = members[0].type;
    const label = members[0].parentRegionLabel || members[0].name || groupType;
    const id = `group:${hash(`${entityId}|${key}|${label}`)}`;
    groups.push({
      id,
      entityId,
      label,
      groupType,
      memberFieldIds: members.map((field) => field.id),
      parentRegionId: '',
      initialState: {},
      discoveredConstraints: []
    });
    for (const member of members) member.parentGroupId = id;
  }
  return groups;
}
