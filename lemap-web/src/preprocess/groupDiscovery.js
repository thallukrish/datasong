import crypto from 'node:crypto';

function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }
function normalize(value) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase(); }

const ACTION_LABEL = /^(continue|proceed|cancel|back|previous|next|submit|save|close|start|start new filing|select status|confirm|ok|okay|finish|done|edit|delete|remove|add|retry)$/i;

function contextFor(field = {}) {
  return String(field.parentRegionLabel || '').trim();
}

function ownerFor(field = {}) {
  return String(field.ownerFieldId || '').trim();
}

function candidateKind(field = {}) {
  if (field.type === 'radio') return 'single';
  if (field.type === 'checkbox') return 'multi';
  if (field.type === 'button') return 'single';
  return '';
}

function bucketKey(field = {}) {
  const context = contextFor(field);
  const owner = ownerFor(field);
  const kind = candidateKind(field);
  if (!kind) return '';

  if (field.type === 'radio' && field.name) return `${owner ? `owner:${owner}|` : ''}single|name:${field.name}`;
  if (!context) return '';
  return `${owner ? `owner:${owner}|` : ''}${kind}|context:${context}`;
}

function isAnswerLikeButtonSet(members = []) {
  if (members.length < 2 || members.length > 8) return false;
  const labels = members.map((field) => normalize(field.label)).filter(Boolean);
  if (labels.length !== members.length) return false;
  if (labels.some((label) => ACTION_LABEL.test(label))) return false;

  const set = new Set(labels);
  if (set.size === 2 && set.has('yes') && set.has('no')) return true;
  return members.length >= 3;
}

function validCandidateSet(members = []) {
  if (members.length < 2) return false;
  const types = new Set(members.map((field) => field.type));
  if (types.size !== 1) return false;
  if (types.has('button')) return isAnswerLikeButtonSet(members);
  return types.has('radio') || types.has('checkbox');
}

function cardinalityFor(members = []) {
  return members[0]?.type === 'checkbox' ? 'zeroOrMore' : 'exactlyOne';
}

function commonOwner(members = []) {
  const owners = new Set(members.map(ownerFor).filter(Boolean));
  return owners.size === 1 && members.every((member) => ownerFor(member) === [...owners][0]) ? [...owners][0] : '';
}

export function discoverGroups(fields = [], entityId = '') {
  const groups = [];
  const buckets = new Map();

  for (const field of fields) {
    const key = bucketKey(field);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(field);
  }

  for (const [key, members] of buckets) {
    if (!validCandidateSet(members)) continue;

    const label = contextFor(members[0]) || members[0].name || 'Choice';
    const cardinality = cardinalityFor(members);
    const id = `group:${hash(`${entityId}|choice|${key}`)}`;
    groups.push({
      id,
      entityId,
      label,
      groupType: 'choice',
      cardinality,
      ownerFieldId: commonOwner(members),
      memberFieldIds: members.map((field) => field.id)
    });
    for (const member of members) member.parentGroupId = id;
  }

  return groups;
}
