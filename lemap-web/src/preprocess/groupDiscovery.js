import crypto from 'node:crypto';
function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }

export function discoverGroups(inputs = [], pageId = '') {
  const groups = [];
  const buckets = new Map();
  for (const input of inputs) {
    if (!['radio', 'checkbox'].includes(input.type)) continue;
    const key = input.type === 'radio'
      ? `radio|${input.name || input.parentRegionLabel}`
      : `checkbox|${input.parentRegionLabel}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(input);
  }
  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const groupType = members[0].type;
    const label = members[0].parentRegionLabel || members[0].name || groupType;
    const id = `group:${hash(`${pageId}|${key}|${label}`)}`;
    groups.push({
      id,
      pageId,
      label,
      groupType,
      memberInputIds: members.map((x) => x.id),
      parentRegionId: '',
      initialState: {},
      discoveredConstraints: []
    });
    for (const member of members) member.parentGroupId = id;
  }
  return groups;
}
