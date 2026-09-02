import crypto from 'node:crypto';

function hash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

export function actionFor(field, kind, value, purpose, safety = 'safe') {
  const identity = [field.entityId || '', field.id || '', kind || '', JSON.stringify(value ?? null), purpose || '', safety || ''].join('|');
  return { id: `action:${hash(identity)}`, fieldId: field.id, kind, value: value ?? null, safety, purpose };
}
