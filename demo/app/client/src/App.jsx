import { useEffect, useMemo, useState } from 'react';

const DEFAULT_BUSINESS = 'Retail and wholesale commerce covering ordering, inventory, fulfillment, invoicing and payments.';
const DEFAULT_REPO = 'https://github.com/moqui/PopCommerce';

export default function App() {
  const [businessDescription, setBusinessDescription] = useState(DEFAULT_BUSINESS);
  const [repoUrl, setRepoUrl] = useState(DEFAULT_REPO);
  const [state, setState] = useState({ status: 'idle', events: [], nodes: [], edges: [], workflows: [], persistentData: [], conditions: [], explorationPlan: null });
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

  const rules = useMemo(() => state.nodes.filter((node) => node.kind === 'condition'), [state.nodes]);
  const concepts = useMemo(() => state.nodes.filter((node) => node.kind === 'business_concept'), [state.nodes]);

  useEffect(() => {
    if (!selectedId && workflows.length) setSelectedId(workflows[0].id);
  }, [selectedId, workflows]);

  const selected = state.nodes.find((node) => node.id === selectedId) || workflows.find((flow) => flow.id === selectedId) || null;
  const latestDiscovery = latestBusinessEvent(state.events);
  const progress = discoveryProgress(state);

  async function explore() {
    setVisited(new Set());
    const response = await fetch('/api/explore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ businessDescription, repoUrl })
    });
    if (!response.ok) { const body = await response.json(); alert(body.error || 'Unable to start exploration'); }
  }

  async function resetKnowledge() {
    const response = await fetch('/api/reset', { method: 'POST' });
    if (!response.ok) return alert('Unable to reset demo knowledge');
    setSelectedId(null); setVisited(new Set());
  }

  function navigate(id) {
    setVisited((current) => new Set([...current, id]));
    setSelectedId(id);
    window.scrollTo({ top: document.querySelector('.wiki-shell')?.offsetTop - 20 || 0, behavior: 'smooth' });
  }

  return (
    <div className="app-shell">
      <header className="brandbar"><div className="brand">DataSong<span>.app</span></div></header>

      <section className="setup">
        <label><span>What does this business do?</span><textarea value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} rows={3} /></label>
        <label><span>GitHub repository</span><input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} /></label>
        <div className="setup-actions">
          <button className="explore-button" onClick={explore} disabled={state.status === 'exploring'}>{state.status === 'exploring' ? 'Exploring…' : state.nodes.length ? 'Continue exploring' : 'Explore'}</button>
          {state.nodes.length > 0 && <button className="reset-button" onClick={resetKnowledge} disabled={state.status === 'exploring'}>Reset demo knowledge</button>}
        </div>
      </section>

      <section className="discovery-strip">
        <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
        <div className="progress-copy"><strong>{progress}%</strong><span>{progressText(latestDiscovery, state.status, state.explorationPlan)}</span></div>
      </section>

      <main className="wiki-shell">
        <aside className="workflow-nav">
          <div className="nav-title">Browse the business</div>
          {!workflows.length && !rules.length && !concepts.length && <div className="nav-empty">The business guide will appear here as DataSong understands the application.</div>}
          <NavSection title="Business flows" items={workflows} selectedId={selectedId} visited={visited} navigate={navigate} />
          <NavSection title="Business rules" items={rules} selectedId={selectedId} visited={visited} navigate={navigate} />
          <NavSection title="Business concepts" items={concepts} selectedId={selectedId} visited={visited} navigate={navigate} />
        </aside>
        <article className="wiki-page">{!selected && <EmptyPage status={state.status} />}{selected && <WikiPage node={selected} state={state} visited={visited} navigate={navigate} />}</article>
        <aside className="related-panel">{!selected && <div className="related-empty">Related workflows and business things will appear here.</div>}{selected && <RelatedPanel node={selected} state={state} visited={visited} navigate={navigate} />}</aside>
      </main>
    </div>
  );
}

function NavSection({ title, items, selectedId, visited, navigate }) {
  if (!items.length) return null;
  return <details className="nav-section" open><summary>{title}<span>{items.length}</span></summary><div className="nav-section-links">
    {items.map((item) => <a key={item.id} href={`#${item.id}`} className={`${selectedId === item.id ? 'active' : ''} ${visited.has(item.id) ? 'visited' : ''}`} onClick={(e) => { e.preventDefault(); navigate(item.id); }}>{item.label || item.name}</a>)}
  </div></details>;
}

function EmptyPage({ status }) {
  return <div className="empty-page"><div className="eyebrow">Business guide</div><h1>{status === 'exploring' ? 'DataSong is learning how this business works.' : 'Explore the business, then browse what DataSong learns.'}</h1><p>Browse workflows, rules and canonical business concepts. Technical variable names and implementation aliases stay underneath the business language rather than becoming duplicate concepts.</p></div>;
}

function WikiPage({ node, state, visited, navigate }) {
  const relatedEdges = state.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
  const relatedNodes = relatedEdges.map((edge) => state.nodes.find((candidate) => candidate.id === (edge.source === node.id ? edge.target : edge.source))).filter(Boolean);
  const persistent = state.persistentData.find((item) => item.id === node.id);
  const condition = state.conditions.find((item) => item.id === node.id);

  return <>
    <div className="page-kicker">{pageType(node.kind)}</div><h1>{node.label || node.name}</h1>
    <LinkedParagraph text={node.description || 'DataSong found this as part of the current business flow.'} state={state} currentId={node.id} visited={visited} navigate={navigate} />
    {relatedEdges.length > 0 && <section className="story-section"><h2>How it connects</h2><div className="story-list">
      {relatedEdges.map((edge) => { const outgoing = edge.source === node.id; const otherId = outgoing ? edge.target : edge.source; const other = state.nodes.find((candidate) => candidate.id === otherId); if (!other) return null; return <p key={edge.id}>{outgoing ? <>This <strong>{edge.relation}</strong> <WikiLink node={other} visited={visited} navigate={navigate} />.</> : <><WikiLink node={other} visited={visited} navigate={navigate} /> <strong>{edge.relation}</strong> this.</>}</p>; })}
    </div></section>}
    {condition && <section className="story-section"><h2>Business rule</h2><p><strong>{condition.label}</strong></p><div className="rule-grid"><span>Yes</span><p>{condition.truePath}</p><span>No</span><p>{condition.falsePath}</p></div></section>}
    {persistent && <section className="story-section technical-section"><h2>Data behind this</h2><p>DataSong found this business information persisted as <code>{persistent.technicalName}</code>.</p><dl><div><dt>How it is used here</dt><dd>{operationText(persistent.operation)}</dd></div>{persistent.fields?.length > 0 && <div><dt>Fields seen in the flow</dt><dd>{persistent.fields.join(', ')}</dd></div>}</dl></section>}
    {node.technicalNames?.length > 0 && !persistent && <section className="story-section technical-section"><h2>Technical names and aliases</h2><p className="technical-note">These are implementation names DataSong traced to this same business concept. They are kept for provenance but do not create separate glossary entries.</p>{node.technicalNames.map((name) => <code className="code-line" key={name}>{name}</code>)}</section>}
    {(node.evidence || []).length > 0 && <details className="evidence-section"><summary>How DataSong knows this</summary>{(node.evidence || []).map((item, index) => <div className="evidence" key={index}>{item}</div>)}</details>}
    {relatedNodes.length === 0 && state.status === 'exploring' && <p className="learning-note">DataSong is still connecting this to the rest of the business story.</p>}
  </>;
}

function RelatedPanel({ node, state, visited, navigate }) {
  const adjacentIds = new Set();
  state.edges.forEach((edge) => { if (edge.source === node.id) adjacentIds.add(edge.target); if (edge.target === node.id) adjacentIds.add(edge.source); });
  const adjacent = state.nodes.filter((candidate) => adjacentIds.has(candidate.id));
  const relatedFlows = adjacent.filter((item) => item.kind === 'workflow');
  const relatedThings = adjacent.filter((item) => ['business_concept', 'condition'].includes(item.kind));
  const relatedData = adjacent.filter((item) => item.kind === 'persistent_data');
  return <><RelatedGroup title="Related workflows" items={relatedFlows} visited={visited} navigate={navigate} /><RelatedGroup title="Things involved" items={relatedThings} visited={visited} navigate={navigate} /><RelatedGroup title="Business data" items={relatedData} visited={visited} navigate={navigate} />{!adjacent.length && <div className="related-empty">DataSong is still finding what connects to this page.</div>}</>;
}

function RelatedGroup({ title, items, visited, navigate }) { if (!items.length) return null; return <section className="related-group"><h3>{title}</h3>{items.map((item) => <WikiLink key={item.id} node={item} visited={visited} navigate={navigate} block />)}</section>; }

function LinkedParagraph({ text, state, currentId, visited, navigate }) {
  const candidates = state.nodes.filter((node) => node.id !== currentId && node.label && node.label.length > 2).sort((a, b) => b.label.length - a.label.length);
  const pattern = candidates.length ? new RegExp(`(${candidates.map((node) => escapeRegExp(node.label)).join('|')})`, 'gi') : null;
  if (!pattern) return <p className="lead">{text}</p>;
  const byLabel = new Map(candidates.map((node) => [node.label.toLowerCase(), node]));
  const parts = text.split(pattern);
  return <p className="lead">{parts.map((part, index) => { const match = byLabel.get(part.toLowerCase()); return match ? <WikiLink key={`${match.id}-${index}`} node={match} visited={visited} navigate={navigate} /> : <span key={index}>{part}</span>; })}</p>;
}

function WikiLink({ node, visited, navigate, block = false }) {
  return <a href={`#${node.id}`} className={`wiki-link ${visited.has(node.id) ? 'visited' : ''} ${block ? 'block-link' : ''}`} onClick={(e) => { e.preventDefault(); navigate(node.id); }}>{node.label || node.name}</a>;
}

function latestBusinessEvent(events = []) {
  const types = new Set(['learning_update', 'workflow_plan_ready', 'workflow_task_started', 'workflow_task_completed', 'workflow_found', 'workflow_enriched', 'node_upserted', 'node_enriched', 'edge_upserted', 'edge_enriched', 'persistent_data_found', 'persistent_data_enriched', 'condition_found', 'condition_enriched', 'exploration_started', 'exploration_complete', 'error']);
  return [...events].reverse().find((event) => types.has(event.type)) || null;
}

function discoveryProgress(state) {
  if (state.status === 'idle') return 0;
  if (state.status === 'complete') return 100;
  const plan = state.explorationPlan;
  const prepareDone = state.events.some((event) => event.type === 'tool_completed' && event.tool === 'repo_prepare');
  if (!prepareDone || !plan || plan.phase === 'assessing') return 5;
  if (!plan.totalWorkflows) return state.status === 'error' ? 10 : 95;

  const completed = plan.completedWorkflows || 0;
  const currentFraction = currentWorkflowFraction(state, plan.currentWorkflowId);
  const workflowFraction = Math.min(plan.totalWorkflows, completed + currentFraction) / plan.totalWorkflows;
  const value = Math.round(10 + workflowFraction * 85);
  return state.status === 'error' ? Math.min(95, value) : Math.min(95, value);
}

function currentWorkflowFraction(state, workflowId) {
  if (!workflowId) return 0;
  const events = state.events.filter((event) => event.workflowTaskId === workflowId || event.task?.id === workflowId);
  if (events.some((event) => event.type === 'workflow_task_completed')) return 1;
  let value = 0.05;
  const completedTools = events.filter((event) => event.type === 'tool_completed');
  if (completedTools.some((event) => ['repo_search', 'repo_list'].includes(event.tool))) value = Math.max(value, 0.18);
  if (completedTools.some((event) => event.tool === 'repo_read_file')) value = Math.max(value, 0.32);
  if (events.some((event) => ['node_upserted', 'node_enriched'].includes(event.type))) value = Math.max(value, 0.48);
  if (events.some((event) => ['condition_found', 'condition_enriched', 'persistent_data_found', 'persistent_data_enriched'].includes(event.type))) value = Math.max(value, 0.62);
  if (events.some((event) => ['edge_upserted', 'edge_enriched'].includes(event.type))) value = Math.max(value, 0.72);
  if (events.some((event) => ['workflow_found', 'workflow_enriched'].includes(event.type))) value = Math.max(value, 0.88);
  return value;
}

function progressText(event, status, plan) {
  if (status === 'idle') return 'Ready to explore the business.';
  if (status === 'complete') return 'Business guide synchronized with the repository.';
  if (status === 'error') return event?.message || 'Exploration needs attention.';
  if (!event) return 'Assessing repository changes…';
  if (event.type === 'workflow_plan_ready') return event.message;
  if (event.type === 'workflow_task_started') return `${event.task?.mode === 'review' ? 'Reviewing' : 'Discovering'} workflow ${workflowOrdinal(plan, event.task?.id)}: ${event.task?.name || 'business workflow'}…`;
  if (event.type === 'workflow_task_completed') return `Completed workflow ${workflowOrdinal(plan, event.task?.id)}: ${event.workflow?.name || event.task?.name}.`;
  if (event.type === 'learning_update') return event.message;
  if (['workflow_found', 'workflow_enriched'].includes(event.type)) return `${event.reused ? 'Enriched' : 'Learned'} business flow: ${event.workflow?.name || 'current workflow'}…`;
  if (['persistent_data_found', 'persistent_data_enriched'].includes(event.type)) return `Learned where ${event.item?.businessLabel || 'business data'} is stored…`;
  if (['condition_found', 'condition_enriched'].includes(event.type)) return `Learned business rule: ${event.condition?.label || 'workflow rule'}…`;
  if (['edge_upserted', 'edge_enriched'].includes(event.type)) return 'Connected another part of the current workflow.';
  if (['node_upserted', 'node_enriched'].includes(event.type)) return `${event.reused ? 'Enriched' : 'Learned'} ${event.node?.label || 'business concept'}…`;
  return event.message || 'Working through the current business workflow…';
}

function workflowOrdinal(plan, id) {
  const work = (plan?.tasks || []).filter((task) => task.status !== 'reused');
  const index = work.findIndex((task) => task.id === id);
  return index >= 0 ? `${index + 1} of ${work.length}` : '';
}

function pageType(kind) { return ({ workflow: 'Business workflow', business_concept: 'Business concept', persistent_data: 'Business data', condition: 'Business rule', service: 'Application behavior' })[kind] || 'Business knowledge'; }
function operationText(operation) { return ({ READ: 'read from this data', CREATE: 'created here', UPDATE: 'updated here', DELETE: 'removed here', READ_WRITE: 'read and updated here' })[operation] || operation; }
function escapeRegExp(value = '') { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
