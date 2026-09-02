function keys(obj) { return new Set(Object.keys(obj || {})); }
function diffAdded(before = [], after = []) { const a = new Set(before || []); return (after || []).filter((x) => !a.has(x)); }
function diffRemoved(before = [], after = []) { const a = new Set(after || []); return (before || []).filter((x) => !a.has(x)); }

export function computeEntityDelta(before = {}, after = {}) {
  const result = {
    fieldValuesChanged: [], fieldsEnabled: [], fieldsDisabled: [], fieldsShown: [], fieldsHidden: [], fieldsAdded: [], fieldsRemoved: [],
    actionsEnabled: [], actionsDisabled: [], actionsShown: [], actionsHidden: [], regionsShown: [], regionsHidden: [],
    validationMessagesAdded: diffAdded(before.validations, after.validations), validationMessagesRemoved: diffRemoved(before.validations, after.validations),
    optionsAdded: {}, optionsRemoved: {},
    routeChanged: before.presentation?.route !== after.presentation?.route,
    entityChanged: before.entityId !== after.entityId
  };

  const beforeFields = before.fields || {};
  const afterFields = after.fields || {};
  for (const id of new Set([...keys(beforeFields), ...keys(afterFields)])) {
    const b = beforeFields[id];
    const a = afterFields[id];
    if (!b) { result.fieldsAdded.push(id); continue; }
    if (!a) { result.fieldsRemoved.push(id); continue; }
    if (JSON.stringify(b.value) !== JSON.stringify(a.value)) result.fieldValuesChanged.push({ fieldId: id, before: b.value ?? null, after: a.value ?? null });
    if (!!b.enabled !== !!a.enabled) (a.enabled ? result.fieldsEnabled : result.fieldsDisabled).push(id);
    if (!!b.visible !== !!a.visible) {
      (a.visible ? result.fieldsShown : result.fieldsHidden).push(id);
      if (a.type === 'button' || b.type === 'button') (a.visible ? result.actionsShown : result.actionsHidden).push(id);
    }
    if ((b.type === 'button' || a.type === 'button') && !!b.enabled !== !!a.enabled) (a.enabled ? result.actionsEnabled : result.actionsDisabled).push(id);
  }

  const beforeRegions = before.regions || {};
  const afterRegions = after.regions || {};
  for (const id of new Set([...keys(beforeRegions), ...keys(afterRegions)])) {
    const b = beforeRegions[id]?.visible;
    const a = afterRegions[id]?.visible;
    if (b !== a) (a ? result.regionsShown : result.regionsHidden).push(id);
  }

  const beforeOptions = before.options || {};
  const afterOptions = after.options || {};
  for (const id of new Set([...keys(beforeOptions), ...keys(afterOptions)])) {
    const added = diffAdded(beforeOptions[id] || [], afterOptions[id] || []);
    const removed = diffRemoved(beforeOptions[id] || [], afterOptions[id] || []);
    if (added.length) result.optionsAdded[id] = added;
    if (removed.length) result.optionsRemoved[id] = removed;
  }
  return result;
}
