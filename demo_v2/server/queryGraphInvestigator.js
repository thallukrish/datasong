const arr = (value) => Array.isArray(value) ? value : [];
const clean = (value, max = 180) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const key = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const uniq = (values) => [...new Set(arr(values).filter(Boolean).map(String))];
const MAX_ROUNDS = 4;
const MAX_FIELDS = 18;
const MAX_FRONTIER_ENTITIES = 20;
const MAX_FRONTIER_WORKFLOWS = 8;

function usageOf(usage = {}) {
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const completion = Number(usage.completion_tokens || usage.output_tokens || 0);
  return { prompt, completion, total:Number(usage.total_tokens || prompt + completion) };
}
function addUsage(total, usage) { total.prompt += usage.prompt; total.completion += usage.completion; total.total += usage.total; }
function parseJson(value) { try { return JSON.parse(value || '{}'); } catch { return {}; } }
function friendlyNode(node) { return node?.id && node?.name && ['entity','workflow'].includes(node.type); }
function questionTerms(question) {
  const q = String(question || '').toLowerCase();
  const terms = new Set(q.split(/[^a-z0-9]+/).filter((word) => word.length > 2));
  if (/sell|sales|sold|revenue/.test(q)) ['order','item','quantity','amount','total','price'].forEach((term) => terms.add(term));
  if (/region|location|geograph|state|country/.test(q)) ['region','state','country','geo','address','postal','contact','party'].forEach((term) => terms.add(term));
  if (/product|item/.test(q)) ['product','item'].forEach((term) => terms.add(term));
  return [...terms];
}
function fieldScore(node, question) {
  const data = node?.data || {};
  const text = `${data.fieldName || node?.name || ''} ${data.description || ''}`.toLowerCase();
  let score = data.isPk ? 5 : 0;
  for (const term of questionTerms(question)) if (text.includes(term)) score += 3;
  if (/orderid|productid|partyid|contactmechid|seqid|geoid/i.test(data.fieldName || node?.name || '')) score += 3;
  return score;
}

function buildIndex(graph = []) {
  const nodes = new Map(arr(graph).filter((node) => node?.id).map((node) => [String(node.id), node]));
  const outgoing = new Map(), incoming = new Map();
  for (const node of nodes.values()) {
    for (const link of arr(node.links)) {
      if (!nodes.has(String(link?.nodeId))) continue;
      const edge = { fromId:String(node.id), toId:String(link.nodeId), relationship:link.relationship || 'related to', cardinality:link.cardinality || 'unknown', data:link.data || {}, confidence:Number(link.confidence || 0), evidence:arr(link.evidence), reverse:false };
      if (!outgoing.has(edge.fromId)) outgoing.set(edge.fromId, []);
      if (!incoming.has(edge.toId)) incoming.set(edge.toId, []);
      outgoing.get(edge.fromId).push(edge); incoming.get(edge.toId).push(edge);
    }
  }
  return { nodes, outgoing, incoming };
}
function edgesFor(index, id) {
  return [
    ...arr(index.outgoing.get(String(id))),
    ...arr(index.incoming.get(String(id))).map((edge) => ({ ...edge, fromId:edge.toId, toId:edge.fromId, reverse:true }))
  ];
}
function catalog(index, type) {
  return [...index.nodes.values()].filter((node) => node.type === type).map((node) => ({
    id:String(node.id), name:clean(node.name, 110), description:clean(node.data?.description || node.data?.intent || node.data?.outcome, 150),
    state:type === 'workflow' ? (node.data?.closureState === 'closed' ? 'complete' : 'learned') : undefined
  }));
}
function fieldsFor(index, entity, question) {
  const direct = edgesFor(index, entity.id).filter((edge) => edge.relationship === 'has field').map((edge) => index.nodes.get(edge.toId)).filter((node) => node?.type === 'field');
  const scoped = [...index.nodes.values()].filter((node) => node.type === 'field' && (node.data?.entityId === entity.id || key(node.data?.entityName) === key(entity.name)));
  const byId = new Map([...direct, ...scoped].map((node) => [node.id, node]));
  return [...byId.values()].sort((a,b) => fieldScore(b,question)-fieldScore(a,question)).slice(0,MAX_FIELDS).map((node) => ({
    field:node.data?.fieldName || node.name.split('.').at(-1), type:node.data?.dataType || '', description:clean(node.data?.description, 100), isPk:!!node.data?.isPk
  }));
}
function nodeDetail(index, node, question) {
  const edges = edgesFor(index, node.id);
  const neighbours = edges.map((edge) => ({ edge, node:index.nodes.get(edge.toId) })).filter((item) => friendlyNode(item.node));
  if (node.type === 'entity') return {
    kind:'entity', id:node.id, name:node.name, description:clean(node.data?.description,140), fields:fieldsFor(index,node,question),
    relatedEntities:neighbours.filter((item)=>item.node.type==='entity').slice(0,16).map(({edge,node:other})=>({
      id:other.id,name:other.name,description:clean(other.data?.description,90),relationship:edge.relationship,cardinality:edge.cardinality,
      relationshipKind:edge.data?.relationshipKind || '',keyMaps:arr(edge.data?.keyMaps),evidenced:edge.data?.evidenced !== false,reverse:edge.reverse
    })),
    workflows:neighbours.filter((item)=>item.node.type==='workflow').slice(0,10).map(({node:other})=>({id:other.id,name:other.name,description:clean(other.data?.intent||other.data?.outcome,90)}))
  };
  return {
    kind:'workflow',id:node.id,name:node.name,description:clean(node.data?.intent||node.data?.outcome,140),
    entities:neighbours.filter((item)=>item.node.type==='entity').slice(0,16).map(({node:other})=>({id:other.id,name:other.name,description:clean(other.data?.description,90)}))
  };
}

function createSession() { return { current:new Map(), history:new Map(), frontier:new Map(), paths:new Map(), presented:new Set() }; }
function compact(detail) {
  if (detail.kind === 'entity') return { kind:'entity',id:detail.id,name:detail.name,description:detail.description,fields:arr(detail.fields).slice(0,8).map(({field,type,isPk})=>({field,type,isPk})),relatedEntities:arr(detail.relatedEntities).slice(0,8).map(({id,name,relationship})=>({id,name,relationship})) };
  return { kind:'workflow',id:detail.id,name:detail.name,description:detail.description,entities:arr(detail.entities).slice(0,10).map(({id,name})=>({id,name})) };
}
function beginRound(session) { for (const [id,detail] of session.current) session.history.set(id,compact(detail)); session.current.clear(); }
function addFrontier(session, candidate, path) {
  if (!friendlyNode(candidate) || session.current.has(candidate.id) || session.history.has(candidate.id) || session.frontier.has(candidate.id)) return;
  session.frontier.set(candidate.id,candidate); session.paths.set(candidate.id,arr(path).slice(-6));
}
function expand(session,index,node,question,path=[]) {
  if (!node) return;
  session.frontier.delete(node.id);
  const detail=nodeDetail(index,node,question); session.current.set(node.id,detail);
  const nextPath=[...arr(path),{kind:node.type,id:node.id,name:node.name,description:clean(node.data?.description||node.data?.intent,100)}].slice(-6);
  session.paths.set(node.id,nextPath);
  for(const edge of edgesFor(index,node.id)){const candidate=index.nodes.get(edge.toId);if(friendlyNode(candidate))addFrontier(session,candidate,nextPath);}
}
function balancedFrontier(session,type,limit){const groups=new Map();for(const node of session.frontier.values()){if(node.type!==type)continue;const path=arr(session.paths.get(node.id)),source=path.at(-1)?.id||'root';if(!groups.has(source))groups.set(source,[]);groups.get(source).push(node);}const queues=[...groups.values()],out=[];while(out.length<limit&&queues.some((queue)=>queue.length)){for(const queue of queues){if(out.length>=limit)break;if(queue.length)out.push(queue.shift());}}return out;}
function contextFor(session) {
  const entities=balancedFrontier(session,'entity',MAX_FRONTIER_ENTITIES),workflows=balancedFrontier(session,'workflow',MAX_FRONTIER_WORKFLOWS);
  session.presented=new Set([...entities,...workflows].map((node)=>node.id));
  return {
    priorExpanded:[...session.history.values()].slice(-8), currentExpanded:[...session.current.values()],
    unselectedEntities:entities.map((node)=>({id:node.id,name:node.name,description:clean(node.data?.description,120)})),
    unselectedWorkflows:workflows.map((node)=>({id:node.id,name:node.name,description:clean(node.data?.intent||node.data?.outcome,120)}))
  };
}
function requestedIds(response,session,index){const available=new Map([...session.presented].map((id)=>{const node=index.nodes.get(id);return[key(node?.name),id];}));const direct=new Set(session.presented);return uniq([...arr(response?.expandNodeIds).map(String).filter((id)=>direct.has(id)),...arr(response?.expandEntities).map((name)=>available.get(key(name))).filter(Boolean),...arr(response?.expandWorkflowIds).map(String).filter((id)=>direct.has(id))]).slice(0,3);}
async function jsonCall(client,model,system,payload,stage,usage,log){const completion=await client.chat.completions.create({model,messages:[{role:'system',content:`Return JSON only. ${system}`},{role:'user',content:JSON.stringify(payload)}],response_format:{type:'json_object'},thinking:{type:'disabled'},temperature:0});const u=usageOf(completion.usage||{});addUsage(usage,u);const message=completion.choices?.[0]?.message||{},raw=message.content||'',parsed=parseJson(raw);log('query_graph_stage',{stage,model,input:payload,output:parsed,rawOutput:raw,finishReason:completion.choices?.[0]?.finish_reason||'',usage:u});return parsed;}

const ANSWER_SYSTEM=`Navigate the supplied semantic graph. currentExpanded contains graph nodes with fields and links. priorExpanded retains compact facts from earlier rounds. Expand only IDs or names listed under unselectedEntities/unselectedWorkflows. For analytics return a precise data view using evidenced graph links and exact fields. If more graph evidence is needed return {"status":"incomplete","missing":[],"expandNodeIds":[]}. Otherwise return {"status":"complete","intent":"","answer":"2-4 concise sentences","dataView":{"grain":"","select":[{"entity":"","field":"","alias":"","role":"key|measure|dimension|time|attribute"}],"joins":[{"left":"Entity.field or Entity","right":"Entity.field or Entity","relation":"","evidenced":true}],"filters":[],"groupBy":[],"orderBy":[],"missing":[]},"nextStep":""}. Schema link keyMaps are authoritative joins. Never invent fields or joins.`;

export async function investigateGraphQuery({question,client,model,graph,log=()=>{}}) {
  const usage={prompt:0,completion:0,total:0},index=buildIndex(graph),workflows=catalog(index,'workflow'),entities=catalog(index,'entity');
  const selected=await jsonCall(client,model,'Select the smallest useful starting set from this semantic graph catalog. Return {"intent":"data_analytics|operations|support|decision_support|other","workflowIds":[],"entityIds":[]}. At most 1 workflow and 3 entities. Use supplied IDs.',{question,workflows,entities},'select',usage,log);
  const validWorkflows=new Set(workflows.map((item)=>item.id)),validEntities=new Set(entities.map((item)=>item.id));
  const selectedIds=uniq([...arr(selected.workflowIds).map(String).filter((id)=>validWorkflows.has(id)).slice(0,1),...arr(selected.entityIds).map(String).filter((id)=>validEntities.has(id)).slice(0,3)]);
  const session=createSession(); for(const id of selectedIds)expand(session,index,index.nodes.get(id),question,[]);
  let response=null,rounds=0;
  for(let round=0;round<=MAX_ROUNDS;round+=1){response=await jsonCall(client,model,ANSWER_SYSTEM,{question,intent:selected.intent||'',expansionRound:round,expansionRoundsRemaining:MAX_ROUNDS-round,context:contextFor(session)},round?`answer_or_expand_${round}`:'answer_or_expand_0',usage,log);if(response?.status!=='incomplete'||round>=MAX_ROUNDS)break;const ids=requestedIds(response,session,index);if(!ids.length){log('query_graph_stop',{reason:'no_presented_graph_neighbour',round,response});break;}beginRound(session);for(const id of ids)expand(session,index,index.nodes.get(id),question,session.paths.get(id));rounds+=1;log('query_graph_expand',{round:rounds,nodeIds:ids,missing:arr(response.missing).slice(0,6)});}
  if(response?.status==='incomplete')response=await jsonCall(client,model,`${ANSWER_SYSTEM} Expansion is closed. Return status=complete and put unresolved evidence under dataView.missing.`,{question,intent:selected.intent||'',context:contextFor(session),unresolvedFromPreviousRound:arr(response.missing).slice(0,8)},'forced_final_answer',usage,log);
  return {...response,investigation:{mode:'native-semantic-graph',graphNodeCount:index.nodes.size,maxExpansionRounds:MAX_ROUNDS,expansionRounds:rounds,selectedNodeIds:selectedIds,selectedEntities:selectedIds.map((id)=>index.nodes.get(id)).filter((node)=>node?.type==='entity').map((node)=>node.name),frontierNodeCount:session.frontier.size,historyNodeCount:session.history.size,usage}};
}
