import { useEffect, useMemo, useState } from 'react';

const DEFAULT_BUSINESS = 'Retail and wholesale commerce covering ordering, inventory, fulfillment, invoicing and payments.';
const DEFAULT_REPO = 'https://github.com/moqui/PopCommerce';

const kindLabel = {
  business_concept: 'Business concept',
  workflow: 'Workflow',
  persistent_data: 'Persistent data',
  service: 'Service',
  condition: 'Condition'
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
  const recentEvents = state.events.slice(-14).reverse();

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
          <div className="tagline">Semantic Explorer — YC demo</div>
        </div>
        <div className={`status status-${state.status}`}>{state.status || 'idle'}</div>
      </header>

      <section className="hero-panel">
        <div className="intro">
          <div className="eyebrow">Give DataSong a business and its code</div>
          <h1>Watch the business explain itself.</h1>
          <p>DataSong explores workflows, traces persistent data, finds the conditions that alter business paths, and builds an evidence-backed semantic map.</p>
        </div>
        <div className="inputs">
          <label>
            What does this business do?
            <textarea value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} rows={3} />
          </label>
          <label>
            Business application repository
            <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
          </label>
          <button onClick={explore} disabled={state.status === 'exploring'}>
            {state.status === 'exploring' ? 'Exploring…' : 'Explore business'}
          </button>
        </div>
      </section>

      <main className="workspace">
        <aside className="activity-panel">
          <div className="panel-heading">What DataSong is discovering</div>
          <div className="activity-list">
            {recentEvents.length === 0 && <div className="empty">Discovery activity will appear here.</div>}
            {recentEvents.map((event) => <Activity key={event.id} event={event} />)}
          </div>
        </aside>

        <section className="map-panel">
          <div className="map-header">
            <div>
              <div className="panel-heading">Living semantic map</div>
              <div className="legend">
                <span>● business</span><span>◆ workflow</span><span>▣ persistent data</span><span>◇ condition</span>
              </div>
            </div>
            <div className="counts">{state.nodes.length} nodes · {state.edges.length} relationships</div>
          </div>

          <SemanticMap state={state} selectedId={selectedId} onSelect={setSelectedId} questionMode={questionMode} />

          {state.status === 'complete' && (
            <div className="question-bar">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} />
              <button onClick={() => setQuestionMode(true)}>Trace through map</button>
            </div>
          )}

          {questionMode && (
            <div className="question-result">
              <strong>DataSong would use the semantic map to identify the workflows and persistent datasets needed to investigate:</strong>
              <span>{question}</span>
              <div className="view-chip-row">
                {['Product', 'Order', 'Inventory', 'Shipment', 'Invoice', 'Payment'].map((x) => <span key={x}>{x}</span>)}
              </div>
              <small>Next product layer: use these mappings to construct a federated analysis view (for example through Trino) and optionally analyze the records.</small>
            </div>
          )}
        </section>

        <aside className="detail-panel">
          <div className="panel-heading">Evidence & details</div>
          {!selected && <div className="empty">Click a map node to inspect business meaning, persistence and evidence.</div>}
          {selected && <NodeDetails node={selected} state={state} />}
        </aside>
      </main>
    </div>
  );
}

function Activity({ event }) {
  const title = event.workflow?.name || event.node?.label || event.item?.label || event.condition?.label || event.message || event.tool;
  const labels = {
    workflow_found: 'Workflow found', persistent_data_found: 'Persistent data', condition_found: 'Condition',
    node_upserted: 'Semantic node', edge_upserted: 'Relationship', tool_completed: 'Repo/tool evidence',
    exploration_started: 'Started', exploration_complete: 'Complete', error: 'Error'
  };
  return <div className="activity"><span className="activity-dot" /><div><strong>{labels[event.type] || event.type}</strong><p>{title || ''}</p></div></div>;
}

function SemanticMap({ state, selectedId, onSelect, questionMode }) {
  const nodes = state.nodes;
  if (!nodes.length) return <div className="map-empty">The map will grow as DataSong finds workflows, business concepts and persistent data.</div>;

  const columns = {
    business_concept: 0,
    workflow: 1,
    condition: 2,
    persistent_data: 3,
    service: 4
  };
  const groups = Object.groupBy ? Object.groupBy(nodes, (node) => node.kind) : nodes.reduce((acc, node) => ((acc[node.kind] ||= []).push(node), acc), {});
  const positioned = new Map();
  Object.entries(groups).forEach(([kind, items]) => items.forEach((node, index) => positioned.set(node.id, { node, x: 70 + (columns[kind] ?? 4) * 230, y: 60 + index * 108 })));
  const width = 1170;
  const height = Math.max(520, ...Array.from(positioned.values()).map((p) => p.y + 100));

  const highlightTerms = ['product', 'order', 'inventory', 'shipment', 'invoice', 'payment', 'sale'];
  const highlighted = new Set(questionMode ? nodes.filter((n) => highlightTerms.some((t) => `${n.id} ${n.label} ${n.description}`.toLowerCase().includes(t))).map((n) => n.id) : []);

  return (
    <div className="map-scroll">
      <svg width={width} height={height} className="map-svg">
        {state.edges.map((edge) => {
          const a = positioned.get(edge.source); const b = positioned.get(edge.target);
          if (!a || !b) return null;
          const active = questionMode && (highlighted.has(edge.source) || highlighted.has(edge.target));
          return <g key={edge.id} className={active ? 'edge active-edge' : 'edge'}>
            <line x1={a.x + 75} y1={a.y + 32} x2={b.x + 75} y2={b.y + 32} />
            <text x={(a.x + b.x) / 2 + 75} y={(a.y + b.y) / 2 + 24}>{edge.relation}</text>
          </g>;
        })}
        {Array.from(positioned.values()).map(({ node, x, y }) => {
          const active = selectedId === node.id || highlighted.has(node.id);
          return <g key={node.id} transform={`translate(${x},${y})`} onClick={() => onSelect(node.id)} className={`node node-${node.kind} ${active ? 'selected' : ''}`}>
            <rect width="150" height="64" rx="16" />
            <text x="75" y="27" textAnchor="middle" className="node-label">{trim(node.label, 22)}</text>
            <text x="75" y="47" textAnchor="middle" className="node-kind">{kindLabel[node.kind] || node.kind}</text>
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
  return <div className="node-details">
    <div className={`detail-kind detail-${node.kind}`}>{kindLabel[node.kind]}</div>
    <h2>{node.label}</h2>
    <p>{node.description}</p>
    {persistent && <>
      <h3>Persistence</h3>
      <div className="kv"><span>Store</span><strong>{persistent.store}</strong></div>
      <div className="kv"><span>Operation</span><strong>{persistent.operation}</strong></div>
      {persistent.fields?.length > 0 && <div className="field-list">{persistent.fields.map((f) => <span key={f}>{f}</span>)}</div>}
    </>}
    {condition && <>
      <h3>Branch</h3>
      <code>{condition.expression}</code>
      <div className="kv"><span>Driven by</span><strong>{condition.driver}</strong></div>
      <div className="branch"><span>TRUE → {condition.truePath}</span><span>FALSE → {condition.falsePath}</span></div>
    </>}
    <h3>Relationships</h3>
    {related.length ? related.map((edge) => <div className="relation" key={edge.id}>{edge.source} <b>{edge.relation}</b> {edge.target}</div>) : <div className="empty small">No recorded relationships yet.</div>}
    <h3>Evidence</h3>
    {(node.evidence || []).map((e, i) => <div className="evidence" key={i}>{e}</div>)}
  </div>;
}

function trim(text = '', n) { return text.length > n ? `${text.slice(0, n - 1)}…` : text; }
