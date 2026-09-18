function arr(value) { return Array.isArray(value) ? value : []; }

function savedValue(saved, name) {
  if (!Object.prototype.hasOwnProperty.call(saved || {}, name)) {
    throw new Error(`Unknown Odoo scenario saved value: ${name}`);
  }
  return saved[name];
}

async function resolveValue(value, fixtures, executor, saved = {}) {
  if (Array.isArray(value)) return Promise.all(value.map((item) => resolveValue(item, fixtures, executor, saved)));
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && value.$saved) {
    return savedValue(saved, value.$saved);
  }
  if (Object.keys(value).length === 1 && value.$ref) {
    if (Object.prototype.hasOwnProperty.call(saved, value.$ref)) return savedValue(saved, value.$ref);
    const fixture = fixtures?.[value.$ref];
    if (!fixture) throw new Error(`Unknown Odoo scenario fixture: ${value.$ref}`);
    return executor.lookup(fixture);
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = await resolveValue(item, fixtures, executor, saved);
  return out;
}

function remember(saved, name, value) {
  if (name) saved[name] = value;
  return value;
}

function normalizeSavedFieldValue(value) {
  if (Array.isArray(value) && value.length === 2
      && (typeof value[0] === 'number' || typeof value[0] === 'string')
      && typeof value[1] === 'string') {
    return value[0];
  }
  return value;
}

function savedFieldValues(rows, field, many) {
  const values = rows
    .map((row) => normalizeSavedFieldValue(row?.[field]))
    .filter((value) => value != null);
  if (!many) return values[0];
  return values.flatMap((value) => Array.isArray(value) ? value : [value]);
}

export class OdooScenarioRunner {
  constructor({ executor, uiResolver, logger = console } = {}) {
    if (!executor) throw new Error('OdooScenarioRunner requires executor');
    if (!uiResolver) throw new Error('OdooScenarioRunner requires uiResolver');
    this.executor = executor;
    this.uiResolver = uiResolver;
    this.logger = logger;
  }

  async runScenario({ enterpriseId, scenario }) {
    const scenarioId = String(scenario?.id || '');
    const sessionId = await this.executor.beginScenario?.({ enterpriseId, scenarioId, scenario }) || '';
    const saved = {};
    let state = { model: scenario.start.model, recordIds: [] };

    for (const action of arr(scenario.actions)) {
      if (action.type === 'open') {
        const model = action.model || state.model;
        const explicitRecordValue = action.recordIds ?? action.recordId;
        let recordIds;
        if (explicitRecordValue !== undefined) {
          const resolved = await resolveValue(explicitRecordValue, scenario.fixtures || {}, this.executor, saved);
          recordIds = Array.isArray(resolved) ? resolved : [resolved];
        } else {
          recordIds = model === state.model ? state.recordIds : [];
        }
        state = { ...state, model, recordIds: recordIds.filter((id) => id != null) };
        await this.executor.open?.({ ...state, action });
        continue;
      }

      if (action.type === 'create') {
        const values = await resolveValue(action.values || scenario.data || {}, scenario.fixtures || {}, this.executor, saved);
        const created = await this.executor.create({
          model: action.model || state.model,
          values
        });
        const recordIds = arr(created?.recordIds || created?.ids);
        state = { ...state, model: action.model || state.model, recordIds };
        remember(saved, action.saveAs, action.many === true ? recordIds : recordIds[0]);
        continue;
      }

      if (action.type === 'find') {
        const model = action.model || state.model;
        const domain = await resolveValue(action.domain || [], scenario.fixtures || {}, this.executor, saved);
        const rows = await this.executor.find({
          model,
          domain,
          fields: arr(action.fields),
          limit: action.limit
        });
        if (action.require !== false && !rows.length) {
          throw new Error(`Odoo scenario find returned no rows for ${model}`);
        }
        const recordIds = rows.map((row) => row.id).filter((id) => id != null);
        state = { ...state, model, recordIds };
        if (action.saveAs) {
          const field = String(action.field || 'id');
          remember(saved, action.saveAs, savedFieldValues(rows, field, action.many === true));
        }
        continue;
      }

      if (action.type === 'read') {
        const fields = arr(action.fields);
        const rows = await this.executor.read({ ...state, fields });
        if (action.saveAs) {
          const field = String(action.field || 'id');
          remember(saved, action.saveAs, savedFieldValues(rows, field, action.many === true));
        }
        continue;
      }

      if (action.type === 'edit') {
        const values = await resolveValue(action.values || {}, scenario.fixtures || {}, this.executor, saved);
        await this.executor.write({ ...state, values });
        continue;
      }

      if (action.type === 'click') {
        const entrypoint = await this.uiResolver.resolveClick({
          model: state.model,
          label: action.label || '',
          xmlId: action.xmlId || '',
          view: scenario.start?.view || ''
        });
        if (!entrypoint?.methodName) throw new Error(`Unable to resolve Odoo click: ${state.model} / ${action.label || action.xmlId}`);
        await this.executor.callMethod({
          ...state,
          methodName: entrypoint.methodName,
          entrypoint,
          args: await resolveValue(arr(action.args), scenario.fixtures || {}, this.executor, saved),
          kwargs: await resolveValue(action.kwargs || {}, scenario.fixtures || {}, this.executor, saved)
        });
        continue;
      }

      if (action.type === 'assert') {
        const assertion = await resolveValue(action, scenario.fixtures || {}, this.executor, saved);
        await this.executor.assert?.({ ...state, assertion });
      }
    }

    await this.executor.endScenario?.({ enterpriseId, scenarioId, sessionId, scenario });
    return { enterpriseId, scenarioId, sessionId, state, saved };
  }
}
