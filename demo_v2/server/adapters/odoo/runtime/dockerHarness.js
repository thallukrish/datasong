import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadOdooScenarioDocument } from './scenarios.js';
import { OdooScenarioRunner } from './scenarioRunner.js';
import { OdooRpcScenarioExecutor } from './rpcExecutor.js';
import { OdooXmlUiResolver } from './viewResolver.js';
import { ensureOdooSource, findOdooUiFiles } from '../frameworkSource.js';

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: false, ...options });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`)));
  });
}

function hostPath(value) { return path.resolve(value).replace(/\\/g, '/'); }

async function waitForHttp(url, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status > 0 && response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for Odoo at ${url}`);
}

async function readXmlSources(repoDir, files = []) {
  const out = [];
  for (const sourcePath of files) {
    const xml = await fs.readFile(path.join(repoDir, sourcePath), 'utf8').catch(() => '');
    if (xml) out.push({ sourcePath, xml });
  }
  return out;
}

export class OdooDockerRuntimeHarness {
  constructor({ enterpriseRepo, scenarioFile, scenarioId = '', odooVersion = process.env.ODOO_VERSION || '19',
    cacheRoot, odooUrl = process.env.ODOO_URL || 'http://localhost:8069',
    db = process.env.ODOO_DB || 'acme_ems', username = process.env.ODOO_USERNAME || 'admin',
    password = process.env.ODOO_PASSWORD || 'admin' } = {}) {
    this.enterpriseRepo = path.resolve(enterpriseRepo);
    this.scenarioFile = path.resolve(scenarioFile);
    this.scenarioId = scenarioId;
    this.odooVersion = String(odooVersion);
    this.cacheRoot = path.resolve(cacheRoot || path.join(process.cwd(), 'data', 'repo-cache'));
    this.odooUrl = String(odooUrl).replace(/\/$/, '');
    this.db = db; this.username = username; this.password = password;
  }

  async prepare() {
    this.document = await loadOdooScenarioDocument(this.scenarioFile);
    this.scenario = this.scenarioId ? this.document.scenarios.find((item) => item.id === this.scenarioId) : this.document.scenarios[0];
    if (!this.scenario) throw new Error(`Odoo scenario not found: ${this.scenarioId}`);

    this.runtimeDir = path.join(this.enterpriseRepo, '.lemap-runtime');
    await fs.mkdir(this.runtimeDir, { recursive: true });
    this.tracePath = path.join(this.runtimeDir, `${this.scenario.id}.jsonl`);
    await fs.writeFile(this.tracePath, '');

    const here = path.dirname(fileURLToPath(import.meta.url));
    this.probeDir = path.join(here, 'odoo_probe', 'lemap_runtime_probe');
    this.sessionId = `lemap-${this.scenario.id}-${Date.now()}`;

    const source = await ensureOdooSource({ version: this.odooVersion, cacheRoot: this.cacheRoot, sourceDir: process.env.ODOO_SOURCE_DIR || '' });
    this.frameworkSource = source;

    const modelNames = [...new Set([String(this.scenario.start?.model || ''), ...this.scenario.actions.map((a) => String(a.model || '')).filter(Boolean)].filter(Boolean))];
    const frameworkUiFiles = await findOdooUiFiles({ repoDir: source.repoDir, modelNames });
    const frameworkSources = await readXmlSources(source.repoDir, frameworkUiFiles);

    const enterpriseXml = [];
    const walk = async (dir) => {
      for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile() && entry.name.endsWith('.xml')) {
          const xml = await fs.readFile(full, 'utf8').catch(() => '');
          if (xml) enterpriseXml.push({ sourcePath: path.relative(this.enterpriseRepo, full).replace(/\\/g, '/'), xml });
        }
      }
    };
    await walk(path.join(this.enterpriseRepo, 'addons'));
    this.uiResolver = OdooXmlUiResolver.fromSources([...enterpriseXml, ...frameworkSources]);

    this.overridePath = path.join(this.runtimeDir, 'docker-compose.lemap-runtime.yml');
    const override = [
      'services:', '  odoo:', '    environment:',
      '      LEMAP_RUNTIME_TRACE: "1"',
      `      LEMAP_RUNTIME_TRACE_FILE: "/mnt/lemap-runtime/${this.scenario.id}.jsonl"`,
      `      LEMAP_ENTERPRISE_ID: "${this.document.enterpriseId}"`,
      `      LEMAP_SCENARIO_ID: "${this.scenario.id}"`,
      `      LEMAP_SESSION_ID: "${this.sessionId}"`,
      '    volumes:',
      `      - "${hostPath(this.probeDir)}:/mnt/lemap-addons/lemap_runtime_probe:ro"`,
      `      - "${hostPath(this.runtimeDir)}:/mnt/lemap-runtime"`,
      '    command:',
      '      - "--addons-path=/usr/lib/python3/dist-packages/odoo/addons,/mnt/extra-addons,/mnt/lemap-addons"',
      '      - "--load=base,web,lemap_runtime_probe"'
    ].join('\n') + '\n';
    await fs.writeFile(this.overridePath, override);
    return { enterpriseId: this.document.enterpriseId, scenarioId: this.scenario.id, tracePath: this.tracePath,
      sessionId: this.sessionId, overridePath: this.overridePath, frameworkSource: source.repoDir };
  }

  composeArgs(...args) {
    return ['compose', '-f', path.join(this.enterpriseRepo, 'docker-compose.yml'), '-f', this.overridePath, ...args];
  }

  async startInstrumentedOdoo() {
    await run('docker', this.composeArgs('up', '-d', 'odoo'), { cwd: this.enterpriseRepo });
    await waitForHttp(`${this.odooUrl}/web/login`);
  }

  async executeScenario() {
    const executor = new OdooRpcScenarioExecutor({ url: this.odooUrl, db: this.db, username: this.username, password: this.password, sessionId: this.sessionId });
    return new OdooScenarioRunner({ executor, uiResolver: this.uiResolver }).runScenario({ enterpriseId: this.document.enterpriseId, scenario: this.scenario });
  }

  async stopInstrumentation() {
    await run('docker', ['compose', '-f', path.join(this.enterpriseRepo, 'docker-compose.yml'), 'up', '-d', '--force-recreate', 'odoo'], { cwd: this.enterpriseRepo });
  }

  async run() {
    const prepared = await this.prepare();
    await this.startInstrumentedOdoo();
    try {
      const scenarioResult = await this.executeScenario();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const stat = await fs.stat(this.tracePath).catch(() => null);
      if (!stat || stat.size === 0) throw new Error(`Odoo runtime probe produced no trace: ${this.tracePath}`);
      return { ...prepared, scenarioResult, traceBytes: stat.size };
    } finally {
      if (!/^(?:0|false|no|off)$/i.test(String(process.env.ODOO_RUNTIME_RESTORE || '1'))) await this.stopInstrumentation();
    }
  }
}
