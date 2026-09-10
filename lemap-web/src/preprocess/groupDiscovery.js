import crypto from 'node:crypto';

function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }
function normalize(value) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase(); }

function buttonChoiceBucket(field = {}) {
  const context = String(field.parentRegionLabel || '').trim();
  if (!context || field.type !== 'button') return '';
  return `choice|${context}`;
}

function looksLikeAnswerButtonSet(members = []) {
  if (members.length < 2 || members.length > 8) return false;
  const labels = members.map((field) => normalize(field.label)).filter(Boolean);
  if (labels.length !== members.length) return false;
  const set = new Set(labels);
  if (set.size === 2 && set.has('yes') && set.has('no')) return true;

  const action = /^(continue|proceed|cancel|back|previous|next|submit|save|close|start|start new filing|select status|confirm|ok|okay)$/i;
  if (labels.some((label) => action.test(label))) return false;
  return members.length >= 3;
}

export function discoverGroups(fields = [], entityId = '') {
  const groups = [];
  const buckets = new Map();

  for (const field of fields) {
    let key = '';
    if (field.type === 'radio') key = `radio|${field.name || field.parentRegionLabel}`;
    else if (field.type === 'checkbox') key = `checkbox|${field.parentRegionLabel}`;
    else key = buttonChoiceBucket(field);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(field);
  }

  for (const [key, members] of buckets) {
    if (members.length < 2) continue;
    const isButtonChoice = key.startsWith('choice|');
    if (isButtonChoice && !looksLikeAnswerButtonSet(members)) continue;

    const groupType = isButtonChoice ? 'choice' : members[0].type;
    const label = members[0].parentRegionLabel || members[0].name || groupType;
    const id = `group:${hash(`${entityId}|${key}|${label}`)}`;
    groups.push({
      id,
      entityId,
      label,
      groupType,
      memberFieldIds: members.map((field) => field.id)
    });
    for (const member of members) member.parentGroupId = id;
  }

  return groups;
}
