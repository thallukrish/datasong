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

  async open() {}

  async create({ model, values }) {
    const id = await this.executeKw(model, 'create', [values]);
    return { recordIds: Array.isArray(id) ? id : [id] };
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
