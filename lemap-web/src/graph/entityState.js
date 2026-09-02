export function projectEntityState(snapshot = {}, graph = {}) {
  const controls = [...(graph.fields || []), ...(graph.actions || [])];
  const fields = {};
  const options = {};
  for (const field of controls) {
    let value = field.value;
    if (field.type === 'radio' && typeof field.checked === 'boolean') value = field.checked ? field.value : null;
    else if (field.type === 'checkbox' && typeof field.checked === 'boolean') value = field.checked;
    else if (snapshot.values && Object.prototype.hasOwnProperty.call(snapshot.values, field.label)) value = snapshot.values[field.label];
    else if (snapshot.values && Object.prototype.hasOwnProperty.call(snapshot.values, field.name)) value = snapshot.values[field.name];
    fields[field.id] = {
      type: field.type,
      value: value ?? null,
      checked: typeof field.checked === 'boolean' ? field.checked : null,
      enabled: !field.disabled,
      visible: !!field.visible,
      required: !!field.required,
      readonly: !!field.readonly
    };
    const dynamic = snapshot.options?.[field.label] || snapshot.options?.[field.name];
    if (Array.isArray(dynamic)) options[field.id] = [...dynamic];
    else if (field.valueDomain?.length) options[field.id] = [...field.valueDomain];
  }
  return {
    entityId: graph.entity?.id || '',
    presentation: { ...(graph.entity?.presentation || {}) },
    fields,
    regions: { ...(snapshot.regions || {}) },
    validations: Array.isArray(snapshot.validations) ? [...snapshot.validations] : [],
    options
  };
}
