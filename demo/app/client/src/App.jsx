import { useEffect, useMemo, useState } from 'react';

const DEFAULT_BUSINESS = 'Retail and wholesale commerce covering ordering, inventory, fulfillment, invoicing and payments.';
const DEFAULT_REPO = 'https://github.com/moqui/PopCommerce';

const kindLabel = {
  business_concept: 'Business thing',
  workflow: 'Business flow',
  persistent_data: 'Stored data',
  service: 'Behind the scenes',
  condition: 'Business decision'
};

export default function App() {
  const [businessDescription, setBusinessDescription] = useState(DEFAULT_BUSINESS);
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO);
  const [state, setState] = useState({ status: 'idle', events: [], nodes: [], edges: [], workflows: [], persistentData: [], conditions: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [question, setQuestion] = useState('Why did sales fall last quarter?');
  const [questionMode, setQuestionMode] = useState(false);

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'snapshot') setState(payload.state);
    };
    return () => events.close();
  }, []);

  const selected = useMemo(() => state.nodes.find((node) => node.id === selectedId), [state.nodes, selectedId]);
  const recentEvents = state.events.filter((event) => event.type !== 'tool_completed').slice(-14).reverse();

  async function explore() {
    setQuestionMode(false);
    setSelectedId(null);
    const response = await fetch('/api/explore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessDescription, repoUrl })
    });
    if (!response.ok) {
      const body = await response.json();
      alert(body.error || 'Unable to start exploration');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">datasong<span>.app</span></div>
          <div className="tagline">See how a business works from the systems that run it</div>
        </div>
        <div className={`status status-${state.status}`}>{statusText(state.status)}</div>
      </header>

      <section className="hero-panel">
        <div className="intro">
          <div className="eyebrow">DataSong is examining this business</div>
          <h1>What happens when a customer places an order?</h1>
          <p>DataSong follows the business flow through the application, connects each step to the data it reads or writes, and keeps the code evidence underneath.</p>
        </div>
        <div className="inputs">
          <label>
            What does this business do?
            <textarea value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} rows={3} />
          </label>
          <label>
            Where does the business logic live?
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
          </label>
          <button onClick={explore} disabled={state.status === 'exploring'}>
            {state.status === 'exploring' ? 'Understanding the order flow…' : 'Explore this business flow'}
          </button>
        </div>
      </section>

      <main className="workspace">
        <aside className="activity-panel">
          <div className="panel-heading">What DataSong understands so far</div>
          <div className="activity-list">
            {recentEvents.length === 0 && <div className="empty">The business story will appear here as DataSong follows the order flow.</div>}
            {recentEvents.map((event) => <Activity key={event.id} event={event} />)}
          </div>
        </aside>

        <section className="map-panel">
          <div className="map-header">
            <div>
              <div className="panel-heading">How this part of the business works</div>
              <div className="legend">
                <span>● business thing</span><span>◆ business flow</span><span>▣ stored data</span><span>◇ decision</span>
              </div>
            </div>
            <div className="counts">{state.nodes.length} things understood · {state.edges.length} connections</div>
          </div>

          <SemanticMap state={state} selectedId={selectedId} onSelect={setSelectedId} questionMode={questionMode} />

          {state.status === 'complete' && (
            <div className="question-bar">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} />
              <button onClick={() => setQuestionMode(true)}>See what matters</button>
            </div>
          )}

          {questionMode && (
            <div className="question-result">
              <strong>To investigate this, DataSong follows the parts of the business that can create, change or block a sale:</strong>
              <span>{question}</span>
              <div className="view-chip-row">
                {['Product', 'Sales Order', 'Inventory', 'Order approval'].map((x) => <span key={x}>{x}</span>)}
              </div>
              <small>The stored-data mappings underneath this story can later be used to build the analysis view across the enterprise data estate.</small>
            </div>
          )}
        </section>

        <aside className="detail-panel">
          <div className="panel-heading">What this means</div>
          {!selected && <div className="empty">Click anything in the story to see what it means and where DataSong found it.</div>}
          {selected && <NodeDetails node={selected} state={state} />}
        </aside>
      </main>
    </div>
  );
}

function Activity({ event }) {
  const title = event.workflow?.name || event.node?.label || event.item?.businessLabel || event.condition?.label || event.message;
  const labels = {
    workflow_found: 'Found the business flow',
    persistent_data_found: 'Found where business data is stored',
    condition_found: 'Found a business decision',
    node_upserted: 'Understood',
    edge_upserted: 'Connected',
    exploration_started: 'Started following the order journey',
    exploration_complete: 'Order journey understood',
    error: 'Could not continue'
  };
  return <div className="activity"><span className="activity-dot" /><div><strong>{labels[event.type] || 'Learned something new'}</strong><p>{title || relationText(event)}</p></div></div>;
}

function relationText(event) {
  if (!event.edge) return '';
  return `${event.edge.source} ${event.edge.relation} ${event.edge.target}`;
}

function SemanticMap({ state, selectedId, onSelect, questionMode }) {
  const nodes = state.nodes.filter((node) => node.kind !== 'service');
  if (!nodes.length) return <div className="map-empty">DataSong is following the order journey. The business story will grow here as each step is understood.</div>;

  const columns = { business_concept: 0, workflow: 1, condition: 2, persistent_data: 3 };
  const groups = Object.groupBy ? Object.groupBy(nodes, (node) => node.kind) : nodes.reduce((acc, node) => ((acc[node.kind] ||= []).push(node), acc), {});
  const positioned = new Map();
  Object.entries(groups).forEach(([kind, items]) => items.forEach((node, index) => positioned.set(node.id, { node, x: 55 + (columns[kind] ?? 3) * 250, y: 55 + index * 118 })));
  const width = 1030;
  const height = Math.max(520, ...Array.from(positioned.values()).map((p) => p.y + 105));

  const highlightTerms = ['product', 'order', 'inventory', 'approval', 'sale'];
  const highlighted = new Set(questionMode ? nodes.filter((n) => highlightTerms.some((t) => `${n.id} ${n.label} ${n.description}`.toLowerCase().includes(t))).map((n) => n.id) : []);

  return (
    <div className="map-scroll">
      <svg width={width} height={height} className="map-svg">
        {state.edges.map((edge) => {
          const a = positioned.get(edge.source); const b = positioned.get(edge.target);
          if (!a || !b) return null;
          const active = questionMode && (highlighted.has(edge.source) || highlighted.has(edge.target));
          return <g key={edge.id} className={active ? 'edge active-edge' : 'edge'}>
            <line x1={a.x + 88} y1={a.y + 35} x2={b.x + 88} y2={b.y + 35} />
            <text x={(a.x + b.x) / 2 + 88} y={(a.y + b.y) / 2 + 26}>{edge.relation}</text>
          </g>;
        })}
        {Array.from(positioned.values()).map(({ node, x, y }) => {
          const active = selectedId === node.id || highlighted.has(node.id);
          return <g key={node.id} transform={`translate(${x},${y})`} onClick={() => onSelect(node.id)} className={`node node-${node.kind} ${active ? 'selected' : ''}`}>
            <rect width="176" height="70" rx="18" />
            <text x="88" y="30" textAnchor="middle" className="node-label">{trim(node.label, 25)}</text>
            <text x="88" y="51" textAnchor="middle" className="node-kind">{kindLabel[node.kind] || ''}</text>
          </g>;
        })}
      </svg>
    </div>
  );
}

function NodeDetails({ node, state }) {
  const related = state.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const persistent = state.persistentData.find((item) => item.id === node.id);
  const condition = state.conditions.find((item) => item.id === node.id);
  const labelsById = new Map(state.nodes.map((item) => [item.id, item.label]));
  return <div className="node-details">
    <div className={`detail-kind detail-${node.kind}`}>{kindLabel[node.kind]}</div>
    <h2>{node.label}</h2>
    <p>{node.description}</p>

    {related.length > 0 && <>
      <h3>How it fits into the story</h3>
      {related.map((edge) => <div className="relation" key={edge.id}>
        {labelsById.get(edge.source) || edge.source} <b>{edge.relation}</b> {labelsById.get(edge.target) || edge.target}
      </div>)}
    </>}

    {persistent && <>
      <h3>Where this lives</h3>
      <div className="kv"><span>Stored as</span><strong>{persistent.technicalName}</strong></div>
      <div className="kv"><span>Used here as</span><strong>{operationText(persistent.operation)}</strong></div>
      {persistent.fields?.length > 0 && <div className="field-list">{persistent.fields.map((f) => <span key={f}>{f}</span>)}</div>}
    </>}

    {condition && <>
      <h3>What changes the path</h3>
      <div className="branch"><span>Yes → {condition.truePath}</span><span>No → {condition.falsePath}</span></div>
      <details className="technical-details"><summary>Technical rule</summary><code>{condition.expression}</code></details>
    </>}

    {node.technicalNames?.length > 0 && <>
      <h3>Behind the scenes</h3>
      <div className="technical-list">{node.technicalNames.map((name) => <code key={name}>{name}</code>)}</div>
    </>}

    <h3>How DataSong knows</h3>
    {(node.evidence || []).map((e, i) => <div className="evidence" key={i}>{e}</div>)}
  </div>;
}

function operationText(operation) {
  return ({ READ: 'read', CREATE: 'created', UPDATE: 'updated', DELETE: 'deleted', READ_WRITE: 'read and updated' })[operation] || operation;
}

function statusText(status) {
  return ({ idle: 'ready', exploring: 'examining business', complete: 'story ready', error: 'needs attention' })[status] || status;
}

function trim(text = '', n) { return text.length > n ? `${text.slice(0, n - 1)}…` : text; }
