export function projectPageState(snapshot = {}, preprocessed = {}) {
  const inputs = {};
  const options = {};
  for (const input of preprocessed.inputs || []) {
    let value = input.value;
    if (snapshot.values && Object.prototype.hasOwnProperty.call(snapshot.values, input.label)) value = snapshot.values[input.label];
    else if (snapshot.values && Object.prototype.hasOwnProperty.call(snapshot.values, input.name)) value = snapshot.values[input.name];
    inputs[input.id] = {
      type: input.type,
      value: value ?? null,
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
