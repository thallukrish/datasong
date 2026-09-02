let seq = 0;
export function actionFor(input, kind, value, purpose, safety = 'safe') {
  seq += 1;
  return { id: `action:${seq}`, inputId: input.id, kind, value: value ?? null, safety, purpose };
}
