(function(){
  function isCausalGoal(goal){
    return Array.isArray(goal)&&String(goal[1]||'')==='causal';
  }

  function evidenceListMarkup(progress,escapeHtml){
    const items=Array.isArray(progress?.hypothesisList)?progress.hypothesisList:[];
    if(!items.length)return '';
    return '<div class="qpath"><div class="label">accepted causal evidence</div>'+
      items.map((claim,index)=>
        '<div class="qstep done">✓ '+(index+1)+'. '+escapeHtml(claim)+'</div>'
      ).join('')+
      '</div>';
  }

  function localRelevanceMetric(progress){
    const value=Math.max(0,Math.min(1,Number(progress?.evidenceRelevance||0)));
    return Math.round(value*100)+'%';
  }

  window.LeMapCausalProgress={
    isCausalGoal,
    evidenceListMarkup,
    localRelevanceMetric
  };
})();