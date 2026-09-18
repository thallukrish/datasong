function arr(value) { return Array.isArray(value) ? value : []; }

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
    let state = { model: scenario.start.model, recordIds: [] };

    for (const action of arr(scenario.actions)) {
      if (action.type === 'open') {
        state = { ...state, model: action.model || state.model };
        await this.executor.open?.({ ...state, action });
        continue;
      }
      if (action.type === 'create') {
        const created = await this.executor.create({
          model: action.model || state.model,
          values: action.values || scenario.data || {},
          fixtures: scenario.fixtures || {}
        });
        state = { ...state, model: action.model || state.model, recordIds: arr(created?.recordIds || created?.ids) };
        continue;
      }
      if (action.type === 'edit') {
        await this.executor.write({ ...state, values: action.values || {} });
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
          args: arr(action.args),
          kwargs: action.kwargs || {}
        });
        continue;
      }
      if (action.type === 'assert') {
        await this.executor.assert?.({ ...state, assertion: action });
      }
    }

    await this.executor.endScenario?.({ enterpriseId, scenarioId, sessionId, scenario });
    return { enterpriseId, scenarioId, sessionId, state };
  }
}
