export const CAUSAL_EVIDENCE_RELEVANCE_MIN = 0.5;

function arr(value){
  return Array.isArray(value)?value:[];
}

export function causalHypothesisText(contributions=[]){
  return arr(contributions)
    .map(item=>String(item?.claim||'').trim())
    .filter(Boolean)
    .join(' -> ');
}

export function evaluateCausalContribution({
  priorContributions=[],
  priorScore=0,
  contribution='',
  evidenceRelevance=0,
  tentativeScore=0,
  inspectedSource=false,
  sourceGrounded=null,
  epsilon=0.03
}={}){
  const claim=String(contribution||'').trim();
  const relevance=Math.max(0,Math.min(1,Number(evidenceRelevance||0)));
  const before=Math.max(0,Math.min(1,Number(priorScore||0)));
  const after=Math.max(0,Math.min(1,Number(tentativeScore||0)));

  if(!claim){
    return {
      accepted:false,
      rejected:false,
      reason:'',
      score:before,
      relevance,
      contributions:arr(priorContributions)
    };
  }

  if(relevance<CAUSAL_EVIDENCE_RELEVANCE_MIN){
    return {
      accepted:false,
      rejected:true,
      reason:'The current evidence is not important enough to the reported issue to add as causal evidence.',
      score:before,
      relevance,
      contributions:arr(priorContributions)
    };
  }

  if(arr(priorContributions).length&&after<before-Number(epsilon||0)){
    return {
      accepted:false,
      rejected:true,
      reason:'Adding this evidence reduced alignment of the accumulated causal hypothesis to the reported issue.',
      score:before,
      relevance,
      contributions:arr(priorContributions)
    };
  }

  if(inspectedSource&&sourceGrounded!==true){
    return {
      accepted:false,
      rejected:true,
      reason:'Exact source did not ground this proposed causal contribution.',
      score:before,
      relevance,
      contributions:arr(priorContributions)
    };
  }

  return {
    accepted:true,
    rejected:false,
    reason:'',
    score:after,
    relevance,
    contributions:arr(priorContributions)
  };
}

export function causalNavigationPicks(picks=[]){
  return arr(picks).filter(pick=>Number(pick?.score||0)>=CAUSAL_EVIDENCE_RELEVANCE_MIN);
}
