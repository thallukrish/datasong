export function projectPageState(snapshot = {}, preprocessed = {}) {
  const inputs = {};
  const options = {};
  for (const input of preprocessed.inputs || []) {
    let value = input.value;
    if (input.type === 'radio' && typeof input.checked === 'boolean') value = input.checked ? input.value : null;
    else if (input.type === 'checkbox' && typeof input.checked === 'boolean') value = input.checked;
    else if (snapshot.values && Object.prototype.hasOwnProperty.call(snapshot.values, input.label)) value = snapshot.values[input.label];
    else if (snapshot.values && Object.prototype.hasOwnProperty.call(snapshot.values, input.name)) value = snapshot.values[input.name];
    inputs[input.id] = {
      type: input.type,
      value: value ?? null,
      checked: typeof input.checked === 'boolean' ? input.checked : null,
      enabled: !input.disabled,
      visible: !!input.visible,
      required: !!input.required,
      readonly: !!input.readonly
    };
    const dynamic = snapshot.options?.[input.label] || snapshot.options?.[input.name];
    if (Array.isArray(dynamic)) options[input.id] = [...dynamic];
    else if (input.valueDomain?.length) options[input.id] = [...input.valueDomain];
  }
  return {
    pageId: preprocessed.page?.id || '',
    route: preprocessed.page?.route || '',
    inputs,
    regions: { ...(snapshot.regions || {}) },
    validations: Array.isArray(snapshot.validations) ? [...snapshot.validations] : [],
    options
  };
}
