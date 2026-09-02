let seq = 0;
export function actionFor(field, kind, value, purpose, safety = 'safe') {
  seq += 1;
  return { id: `action:${seq}`, fieldId: field.id, kind, value: value ?? null, safety, purpose };
}
