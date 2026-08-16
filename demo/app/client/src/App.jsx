import { useEffect, useMemo, useState } from 'react';

const DEFAULT_BUSINESS = 'Retail and wholesale commerce covering ordering, inventory, fulfillment, invoicing and payments.';
const DEFAULT_REPO = 'https://github.com/moqui/PopCommerce';

export default function App() {
  const [businessDescription, setBusinessDescription] = useState(DEFAULT_BUSINESS);
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO);
  const [state, setState] = useState({ status: 'idle', events: [], nodes: [], edges: [], workflows: [], persistentData: [], conditions: [] });
  const [selectedId, setSelectedId] = useState(null);
  const [visited, setVisited] = useState(new Set());

  useEffect(() => {
    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'snapshot') setState(payload.state);
    };
    return () => events.close();
  }, []);

  const workflows = useMemo(() => {
    const byId = new Map(state.nodes.map((node) => [node.id, node]));
    return state.workflows.map((flow) => byId.get(flow.id) || { id: flow.id, label: flow.name, description: flow.description, kind: 'workflow', evidence: flow.evidence, technicalNames: flow.technicalNames });
  }, [state.nodes, state.workflows]);

  useEffect(() => {
    if (!selectedId && workflows.length) setSelectedId(workflows[0].id);
  }, [selectedId, workflows]);

  const selected = state.nodes.find((node) => node.id === selectedId) || workflows.find((flow) => flow.id === selectedId) || null;
  const latestDiscovery = [...state.events].reverse().find((event) => event.type !== 'tool_completed');
  const progress = discoveryProgress(state);

  async function explore() {
    setSelectedId(null);
    setVisited(new Set());
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

  function navigate(id) {
    setVisited((current) => new Set([...current, id]));
    setSelectedId(id);
    window.scrollTo({ top: document.querySelector('.wiki-shell')?.offsetTop - 20 || 0, behavior: 'smooth' });
  }

  return (
    <div className="app-shell">
      <header className="brandbar">
        <div className="brand">DataSong<span>.app</span></div>
      </header>

      <section className="setup">
        <label>
          <span>What does this business do?</span>
          <textarea value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} rows={3} />
        </label>
        <label>
          <span>GitHub repository</span>
          <input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
        </label>
        <button onClick={explore} disabled={state.status === 'exploring'}>
          {state.status === 'exploring' ? 'Exploring…' : 'Explore'}
        </button>
      </section>

      <section className="discovery-strip">
        <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        <div className="progress-copy">
          <strong>{progress}%</strong>
          <span>{progressText(latestDiscovery, state.status)}</span>
        </div>
      </section>

      <main className="wiki-shell">
        <aside className="workflow-nav">
          <div className="nav-title">Business flows</div>
          {!workflows.length && <div className="nav-empty">Workflows will appear here as DataSong understands the business.</div>}
          {workflows.map((flow) => (
            <a
              key={flow.id}
              href={`#${flow.id}`}
              className={`${selectedId === flow.id ? 'active' : ''} ${visited.has(flow.id) ? 'visited' : ''}`}
              onClick={(e) => { e.preventDefault(); navigate(flow.id); }}
            >
              {flow.label || flow.name}
            </a>
          ))}
        </aside>

        <article className="wiki-page">
          {!selected && <EmptyPage status={state.status} />}
          {selected && <WikiPage node={selected} state={state} visited={visited} navigate={navigate} />}
        </article>

        <aside className="related-panel">
          {!selected && <div className="related-empty">Related workflows and business things will appear here.</div>}
          {selected && <RelatedPanel node={selected} state={state} visited={visited} navigate={navigate} />}
        </aside>
      </main>
    </div>
  );
}

function EmptyPage({ status }) {
  return <div className="empty-page">
    <div className="eyebrow">Business guide</div>
    <h1>{status === 'exploring' ? 'DataSong is learning how this business works.' : 'Explore the business, then browse what DataSong learns.'}</h1>
    <p>Workflows become the entry points. From there you can follow customers, products, orders, inventory and the business data underneath them like a wiki.</p>
  </div>;
}

function WikiPage({ node, state, visited, navigate }) {
  const relatedEdges = state.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const relatedNodes = relatedEdges
    .map((edge) => state.nodes.find((candidate) => candidate.id === (edge.source === node.id ? edge.target : edge.source)))
    .filter(Boolean);
  const persistent = state.persistentData.find((item) => item.id === node.id);
  const condition = state.conditions.find((item) => item.id === node.id);

  return <>
    <div className="page-kicker">{pageType(node.kind)}</div>
    <h1>{node.label || node.name}</h1>
    <LinkedParagraph text={node.description || 'DataSong found this as part of the current business flow.'} state={state} currentId={node.id} visited={visited} navigate={navigate} />

    {relatedEdges.length > 0 && <section className="story-section">
      <h2>How it connects</h2>
      <div className="story-list">
        {relatedEdges.map((edge) => {
          const outgoing = edge.source === node.id;
          const otherId = outgoing ? edge.target : edge.source;
          const other = state.nodes.find((candidate) => candidate.id === otherId);
          if (!other) return null;
          return <p key={edge.id}>
            {outgoing ? <>This <strong>{edge.relation}</strong> <WikiLink node={other} visited={visited} navigate={navigate} />.</> : <><WikiLink node={other} visited={visited} navigate={navigate} /> <strong>{edge.relation}</strong> this.</>}
          </p>;
        })}
      </div>
    </section>}

    {condition && <section className="story-section">
      <h2>Business rule</h2>
      <p><strong>{condition.label}</strong></p>
      <div className="rule-grid"><span>Yes</span><p>{condition.truePath}</p><span>No</span><p>{condition.falsePath}</p></div>
    </section>}

    {persistent && <section className="story-section technical-section">
      <h2>Data behind this</h2>
      <p>DataSong found this business information persisted as <code>{persistent.technicalName}</code>.</p>
      <dl>
        <div><dt>How it is used here</dt><dd>{operationText(persistent.operation)}</dd></div>
        {persistent.fields?.length > 0 && <div><dt>Fields seen in the flow</dt><dd>{persistent.fields.join(', ')}</dd></div>}
      </dl>
    </section>}

    {node.technicalNames?.length > 0 && !persistent && <section className="story-section technical-section">
      <h2>Behind the scenes</h2>
      {node.technicalNames.map((name) => <code className="code-line" key={name}>{name}</code>)}
    </section>}

    {(node.evidence || []).length > 0 && <details className="evidence-section">
      <summary>How DataSong knows this</summary>
      {(node.evidence || []).map((item, index) => <div className="evidence" key={index}>{item}</div>)}
    </details>}

    {relatedNodes.length === 0 && state.status === 'exploring' && <p className="learning-note">DataSong is still connecting this to the rest of the business story.</p>}
  </>;
}

function RelatedPanel({ node, state, visited, navigate }) {
  const adjacentIds = new Set();
  state.edges.forEach((edge) => {
    if (edge.source === node.id) adjacentIds.add(edge.target);
    if (edge.target === node.id) adjacentIds.add(edge.source);
  });
  const adjacent = state.nodes.filter((candidate) => adjacentIds.has(candidate.id));
  const relatedFlows = adjacent.filter((item) => item.kind === 'workflow');
  const relatedThings = adjacent.filter((item) => ['business_concept', 'condition'].includes(item.kind));
  const relatedData = adjacent.filter((item) => item.kind === 'persistent_data');

  return <>
    <RelatedGroup title="Related workflows" items={relatedFlows} visited={visited} navigate={navigate} />
    <RelatedGroup title="Things involved" items={relatedThings} visited={visited} navigate={navigate} />
    <RelatedGroup title="Business data" items={relatedData} visited={visited} navigate={navigate} />
    {!adjacent.length && <div className="related-empty">DataSong is still finding what connects to this page.</div>}
  </>;
}

function RelatedGroup({ title, items, visited, navigate }) {
  if (!items.length) return null;
  return <section className="related-group">
    <h3>{title}</h3>
    {items.map((item) => <WikiLink key={item.id} node={item} visited={visited} navigate={navigate} block />)}
  </section>;
}

function LinkedParagraph({ text, state, currentId, visited, navigate }) {
  const candidates = state.nodes
    .filter((node) => node.id !== currentId && node.label && node.label.length > 2)
    .sort((a, b) => b.label.length - a.label.length);

  const pattern = candidates.length
    ? new RegExp(`(${candidates.map((node) => escapeRegExp(node.label)).join('|')})`, 'gi')
    : null;

  if (!pattern) return <p className="lead">{text}</p>;
  const byLabel = new Map(candidates.map((node) => [node.label.toLowerCase(), node]));
  const parts = text.split(pattern);
  return <p className="lead">{parts.map((part, index) => {
    const match = byLabel.get(part.toLowerCase());
    return match ? <WikiLink key={`${match.id}-${index}`} node={match} visited={visited} navigate={navigate} /> : <span key={index}>{part}</span>;
  })}</p>;
}

function WikiLink({ node, visited, navigate, block = false }) {
  return <a
    href={`#${node.id}`}
    className={`wiki-link ${visited.has(node.id) ? 'visited' : ''} ${block ? 'block-link' : ''}`}
    onClick={(e) => { e.preventDefault(); navigate(node.id); }}
  >{node.label || node.name}</a>;
}

function discoveryProgress(state) {
  if (state.status === 'idle') return 0;
  if (state.status === 'complete') return 100;
  if (state.status === 'error') return Math.min(95, progressWhileExploring(state));
  return progressWhileExploring(state);
}

function progressWhileExploring(state) {
  const startedTools = state.events.filter((event) => event.type === 'tool_started');
  const semanticEvents = state.events.filter((event) => ['workflow_found', 'node_upserted', 'edge_upserted', 'persistent_data_found', 'condition_found'].includes(event.type));

  let base = 8;
  if (startedTools.some((event) => event.tool === 'repo_prepare')) base = 14;
  if (startedTools.some((event) => ['repo_list', 'repo_search'].includes(event.tool))) base = 22;
  if (startedTools.some((event) => event.tool === 'repo_read_file')) base = 30;
  if (startedTools.some((event) => event.tool?.startsWith('semantic_record_'))) base = 40;

  return Math.min(96, base + semanticEvents.length * 4 + Math.min(12, startedTools.length));
}

function progressText(event, status) {
  if (status === 'idle') return 'Ready to explore the business.';
  if (status === 'complete') return 'Business guide ready to browse.';
  if (status === 'error') return event?.message || 'Exploration needs attention.';
  if (!event) return 'Reading the application structure…';
  if (event.type === 'tool_started' || event.type === 'model_working') return event.message || 'Following the business flow…';
  if (event.type === 'workflow_found') return `Found a business flow: ${event.workflow?.name || 'following it now'}…`;
  if (event.type === 'persistent_data_found') return `Found where ${event.item?.businessLabel || 'business data'} is stored…`;
  if (event.type === 'condition_found') return `Found a business rule: ${event.condition?.label || 'checking its effect'}…`;
  if (event.type === 'edge_upserted') return `Connecting ${event.edge?.source || 'one part'} to ${event.edge?.target || 'another'}…`;
  if (event.type === 'node_upserted') return `Understanding ${event.node?.label || 'another part of the business'}…`;
  return event.message || 'Following the business flow through the application…';
}

function pageType(kind) {
  return ({ workflow: 'Business workflow', business_concept: 'Business concept', persistent_data: 'Business data', condition: 'Business rule', service: 'Application behavior' })[kind] || 'Business knowledge';
}

function operationText(operation) {
  return ({ READ: 'read from this data', CREATE: 'created here', UPDATE: 'updated here', DELETE: 'removed here', READ_WRITE: 'read and updated here' })[operation] || operation;
}

function escapeRegExp(value = '') {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
