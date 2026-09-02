function keys(obj) { return new Set(Object.keys(obj || {})); }
function diffAdded(before = [], after = []) { const a = new Set(before || []); return (after || []).filter((x) => !a.has(x)); }
function diffRemoved(before = [], after = []) { const a = new Set(after || []); return (before || []).filter((x) => !a.has(x)); }

export function computeStateDelta(before = {}, after = {}) {
  const result = {
    inputValuesChanged: [], inputsEnabled: [], inputsDisabled: [], inputsShown: [], inputsHidden: [], inputsAdded: [], inputsRemoved: [],
    groupsChanged: [], regionsShown: [], regionsHidden: [], actionsEnabled: [], actionsDisabled: [], actionsShown: [], actionsHidden: [],
    validationMessagesAdded: diffAdded(before.validations, after.validations), validationMessagesRemoved: diffRemoved(before.validations, after.validations),
    optionsAdded: {}, optionsRemoved: {}, routeChanged: before.route !== after.route, pageChanged: before.pageId !== after.pageId
  };

  const beforeInputs = before.inputs || {};
  const afterInputs = after.inputs || {};
  for (const id of new Set([...keys(beforeInputs), ...keys(afterInputs)])) {
    const b = beforeInputs[id];
    const a = afterInputs[id];
    if (!b) { result.inputsAdded.push(id); continue; }
    if (!a) { result.inputsRemoved.push(id); continue; }
    if (JSON.stringify(b.value) !== JSON.stringify(a.value)) result.inputValuesChanged.push({ inputId: id, before: b.value ?? null, after: a.value ?? null });
    if (!!b.enabled !== !!a.enabled) (a.enabled ? result.inputsEnabled : result.inputsDisabled).push(id);
    if (!!b.visible !== !!a.visible) {
      (a.visible ? result.inputsShown : result.inputsHidden).push(id);
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
