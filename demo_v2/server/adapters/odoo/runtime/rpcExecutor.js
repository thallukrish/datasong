let RPC_ID = 1;

async function jsonRpc(url, service, method, args) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: RPC_ID++
    })
  });
  if (!response.ok) throw new Error(`Odoo RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error?.data?.message || payload.error?.message || 'Odoo RPC failed');
  return payload.result;
}

export class OdooRpcScenarioExecutor {
  constructor({ url, db, username, password, sessionId = '' } = {}) {
    this.url = String(url || '').replace(/\/$/, '') + '/jsonrpc';
    this.db = db;
    this.username = username;
    this.password = password;
    this.sessionId = sessionId || `odoo-run-${Date.now()}`;
    this.uid = null;
  }

  async authenticate() {
    if (this.uid) return this.uid;
    this.uid = await jsonRpc(this.url, 'common', 'authenticate', [this.db, this.username, this.password, {}]);
    if (!this.uid) throw new Error('Odoo authentication failed');
    return this.uid;
  }

  async executeKw(model, method, args = [], kwargs = {}) {
    const uid = await this.authenticate();
    return jsonRpc(this.url, 'object', 'execute_kw', [
      this.db, uid, this.password, model, method, args, kwargs
    ]);
  }

  async beginScenario() {
    await this.authenticate();
    return this.sessionId;
  }

  async open({ model, recordIds = [], action = {} } = {}) {
    const viewType = String(action.view || action.viewType || 'form');
    const viewId = action.viewId == null ? false : action.viewId;
    const views = await this.executeKw(model, 'get_views', [[[viewId, viewType]]], {
      options: { toolbar: true, load_filters: true }
    });

    const arch = String(views?.views?.[viewType]?.arch || '');
    const fieldNames = [...new Set(
      [...arch.matchAll(/<field\\b[^>]*\\bname=[\"']([^\"']+)[\"']/gi)]
        .map((match) => String(match[1] || '').trim())
        .filter(Boolean)
    )];

    const ids = Array.isArray(recordIds) ? recordIds.filter((id) => id != null) : [];
    if (!ids.length) {
      if (fieldNames.length) {
        await this.executeKw(model, 'default_get', [fieldNames], {});
      }
      return { views, recordIds: [], fields: fieldNames };
    }

    if (!fieldNames.length) {
      await this.executeKw(model, 'read', [ids], { fields: [] });
      return { views, recordIds: ids, fields: [] };
    }

    const specification = Object.fromEntries(fieldNames.map((name) => [name, {}]));
    try {
      await this.executeKw(model, 'web_read', [ids, specification], {});
    } catch {
      await this.executeKw(model, 'read', [ids], { fields: fieldNames });
    }
    return { views, recordIds: ids, fields: fieldNames };
  }

  async lookup(fixture = {}) {
    const model = String(fixture.model || '');
    const domain = Array.isArray(fixture.domain) ? fixture.domain : [];
    const field = String(fixture.field || 'id');
    const rows = await this.executeKw(model, 'search_read', [domain], {
      fields: [field],
      limit: Number(fixture.limit || 1)
    });
    if (!Array.isArray(rows) || !rows.length) {
      throw new Error(`Odoo fixture lookup returned no rows for ${model}`);
    }
    const value = rows[0]?.[field];
    if (value == null) throw new Error(`Odoo fixture lookup missing field ${field} on ${model}`);
    return Array.isArray(value) ? value[0] : value;
  }

  async create({ model, values }) {
    const id = await this.executeKw(model, 'create', [values]);
    return { recordIds: Array.isArray(id) ? id : [id] };
  }

  async find({ model, domain = [], fields = [], limit } = {}) {
    const kwargs = {};
    if (Array.isArray(fields) && fields.length) kwargs.fields = ['id', ...fields.filter((field) => field !== 'id')];
    if (limit != null) kwargs.limit = Number(limit);
    return this.executeKw(model, 'search_read', [domain], kwargs);
  }

  async read({ model, recordIds = [], fields = [] } = {}) {
    return this.executeKw(model, 'read', [recordIds], {
      fields: Array.isArray(fields) ? fields : []
    });
  }

  async write({ model, recordIds, values }) {
    return this.executeKw(model, 'write', [recordIds, values]);
  }

  async callMethod({ model, recordIds, methodName, args = [], kwargs = {} }) {
    return this.executeKw(model, methodName, [recordIds, ...args], kwargs);
  }

  async assert({ assertion }) {
    if (!assertion?.methodName) return true;
    return this.executeKw(assertion.model, assertion.methodName, assertion.args || [], assertion.kwargs || {});
  }

  async endScenario() {}
}
