(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.LeMapLearnStatus=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function arr(value){return Array.isArray(value)?value:[]}
  function progress(arc){return Math.max(0,Math.min(100,Math.round(Number(arc?.progress||0))))}
  function activeId(state){return String(state?.pass1Scheduler?.activeArcId||'')}

  function workflowState(arc,state,busy){
    if(!arc)return'';
    const pct=progress(arc);
    if(arc.closureState==='closed'||pct>=100)return'Complete';
    if(arc.closureState==='needs_call_path'||arc.pass2Unavailable)return'Needs call path';
    const active=String(arc.id||'')===activeId(state);
    const flow=state?.pass2WholeFlowByArc?.[arc.id]||null;
    if(busy&&active){
      if(state?.status==='preparing')return'Preparing repository…';
      if(flow?.completed)return'Applying learned workflow…';
      if(flow?.started)return'Interpreting compressed workflow…';
      return'Preparing Pass 2…';
    }
    if(pct>0)return'Waiting to continue';
    return'Waiting';
  }

  function activity(arcs,state,busy){
    const list=arr(arcs);
    if(!list.length)return busy?'Preparing enterprise map…':'Ready to learn';
    const complete=list.filter(arc=>arc?.closureState==='closed'||progress(arc)>=100).length;
    const remaining=Math.max(0,list.length-complete);
    if(!busy)return`Persisted map loaded · ${complete} complete · ${remaining} remaining`;
    if(state?.status==='preparing')return`Preparing repository · ${complete} complete · ${remaining} remaining`;
    const active=list.find(arc=>String(arc?.id||'')===activeId(state));
    if(active)return`Pass 2 · ${active.title||'Active workflow'} · ${complete} complete · ${remaining} remaining`;
    return`Learning workflows · ${complete} complete · ${remaining} remaining`;
  }

  return{workflowState,activity};
});
