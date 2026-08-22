const arr = (value) => Array.isArray(value) ? value : [];
const clone = (value) => JSON.parse(JSON.stringify(value));

function edgeList(graph = []) {
  return arr(graph).flatMap((node) => arr(node?.links).map((link) => ({
    fromId:String(node.id || ''), toId:String(link?.nodeId || ''), relationship:String(link?.relationship || 'related to'),
    cardinality:String(link?.cardinality || 'unknown'), data:link?.data || {}, confidence:Number(link?.confidence || 0)
  })));
}

function entityDetail(node, nodes, edges) {
  const fields = edges.filter((edge) => edge.fromId === node.id && edge.relationship === 'has field')
    .map((edge) => nodes.get(edge.toId)).filter((field) => field?.type === 'field')
    .map((field) => ({
      name:String(field.data?.fieldName || field.name?.split('.').at(-1) || ''),
      type:String(field.data?.dataType || ''), isPk:!!field.data?.isPk,
      description:String(field.data?.description || ''), sourceEntity:String(field.data?.sourceEntity || node.name || ''),
      physicalFieldName:String(field.data?.physicalFieldName || field.data?.fieldName || ''), authoritative:field.data?.authoritative === true
    })).filter((field) => field.name);
  return {
    name:String(node.name || ''), description:String(node.data?.description || ''),
    schemaResolved:!!node.data?.schemaResolved, schemaName:String(node.data?.schemaName || node.name || ''),
    schemaSourcePath:String(node.data?.schemaSourcePath || ''), schemaComponent:String(node.data?.schemaComponent || ''), fields
  };
}

function relationshipDetail(edge, nodes) {
  const from=nodes.get(edge.fromId),to=nodes.get(edge.toId);
  if (from?.type !== 'entity' || to?.type !== 'entity') return null;
  return {
    from:String(from.name || ''), relation:edge.relationship, to:String(to.name || ''),
    description:String(edge.data?.description || ''), cardinality:edge.cardinality,
    relationshipKind:String(edge.data?.relationshipKind || 'business'), keyMaps:clone(arr(edge.data?.keyMaps)),
    evidenced:edge.data?.evidenced !== false
  };
}

export function graphQueryProjection(graph = []) {
  const nodes=new Map(arr(graph).filter((node)=>node?.id).map((node)=>[String(node.id),node])),edges=edgeList(graph);
  const entityNodes=[...nodes.values()].filter((node)=>node.type==='entity');
  const detailsById=new Map(entityNodes.map((node)=>[node.id,entityDetail(node,nodes,edges)]));
  const workflows=[];
  for(const workflow of [...nodes.values()].filter((node)=>node.type==='workflow')){
    const entityIds=new Set(edges.filter((edge)=>edge.fromId===workflow.id&&edge.relationship==='uses entity'&&nodes.get(edge.toId)?.type==='entity').map((edge)=>edge.toId));
    const workflowSteps=edges.filter((edge)=>edge.fromId===workflow.id&&edge.relationship==='contains step'&&nodes.get(edge.toId)?.type==='step')
      .map((edge)=>nodes.get(edge.toId)).sort((a,b)=>Number(a?.data?.order||0)-Number(b?.data?.order||0))
      .map((step,index)=>({name:String(step.name||`Step ${index+1}`),description:String(step.data?.description||''),effect:String(step.data?.effect||''),order:Number(step.data?.order||index+1)}));
    const workflowRelationships=edges.filter((edge)=>edge.data?.relationshipKind!=='schema_fk'&&(edge.data?.workflowId===workflow.id||(entityIds.has(edge.fromId)&&entityIds.has(edge.toId)))).map((edge)=>relationshipDetail(edge,nodes)).filter(Boolean);
    workflows.push({
      id:String(workflow.id),title:String(workflow.name||''),businessActor:String(workflow.data?.actor||''),
      businessIntent:String(workflow.data?.intent||''),businessOutcome:String(workflow.data?.outcome||''),outcome:String(workflow.data?.outcome||''),
      closureState:String(workflow.data?.closureState||''),progress:Number(workflow.data?.progress||0),
      entities:[...entityIds].map((id)=>nodes.get(id)?.name).filter(Boolean),
      entityDetails:[...entityIds].map((id)=>detailsById.get(id)).filter(Boolean),workflowSteps,relationshipDetails:workflowRelationships
    });
  }
  const schemaRelationships=edges.filter((edge)=>edge.data?.relationshipKind==='schema_fk').map((edge)=>relationshipDetail(edge,nodes)).filter(Boolean);
  const schemaEntityIds=new Set(schemaRelationships.flatMap((relationship)=>{
    const ids=[];for(const node of entityNodes)if(node.name===relationship.from||node.name===relationship.to)ids.push(node.id);return ids;
  }));
  const navigationArc={
    id:'__schema_graph_navigation__',title:'Schema graph navigation',hiddenFromWorkflows:true,entities:[],persistentObjects:[],
    entityDetails:[...schemaEntityIds].map((id)=>detailsById.get(id)).filter(Boolean),relationshipDetails:schemaRelationships
  };
  return { workflows, navigationArcs:schemaRelationships.length?[navigationArc]:[] };
}
