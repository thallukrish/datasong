(function(){
  function isCausalGoal(goal){
    return Array.isArray(goal)&&String(goal[1]||'')==='causal';
  }

  function evidenceListMarkup(progress,escapeHtml){
    const items=Array.isArray(progress?.hypothesisList)?progress.hypothesisList:[];
    if(!items.length){
      return '<div class="qpath"><div class="label">accepted causal evidence</div><div class="small">No causal evidence accepted yet.</div></div>';
    }
    return '<div class="qpath"><div class="label">accepted causal evidence forming the hypothesis</div>'+
      items.map((item,index)=>{
        const row=typeof item==='string'?{claim:item}:item||{};
        const where=row.sourcePath
          ? row.sourcePath+(row.startLine?':'+row.startLine+(row.endLine&&row.endLine!==row.startLine?'-'+row.endLine:''):'')
          : '';
        const meta=[
          where,
          row.sourceGrounded===true?'source grounded':'',
          Number(row.evidenceRelevance||0)>0?'local contribution yes':''
        ].filter(Boolean).join(' · ');
        return '<div class="qstep done">✓ '+(index+1)+'. '+escapeHtml(row.claim||'')+
          (meta?'<div class="small">'+escapeHtml(meta)+'</div>':'')+
          '</div>';
      }).join('')+
      '</div>';
  }

  function localRelevanceMetric(progress){
    return Number(progress?.evidenceRelevance||0)>0?'yes':'no';
  }

  window.LeMapCausalProgress={
    isCausalGoal,
    evidenceListMarkup,
    localRelevanceMetric
  };
})();