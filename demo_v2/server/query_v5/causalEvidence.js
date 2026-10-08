function arr(value){
  return Array.isArray(value)?value:[];
}

export function retainCausalContributions(contributions=[],indexes=[]){
  const source=arr(contributions);
  const keep=new Set(
    arr(indexes).map(Number).filter(index=>Number.isInteger(index)&&index>=0&&index<source.length)
  );
  return source.filter((_,index)=>keep.has(index));
}

export function causalHypothesisText(contributions=[]){
  return arr(contributions)
    .map(item=>String(item?.claim||'').trim())
    .filter(Boolean)
    .join(' -> ');
}

function normalizeClaim(value){
  return String(value||'')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function evaluateCausalContribution({
  priorContributions=[],
  priorScore=0,
  contribution='',
  evidenceRelevance=0,
  tentativeScore=0,
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

  const normalized=normalizeClaim(claim);
  const duplicate=normalized&&arr(priorContributions).some(item=>
    normalizeClaim(item?.claim||'')===normalized
  );
  if(duplicate){
    return {
      accepted:false,
      rejected:false,
      duplicate:true,
      reason:'The contribution is already represented in the accepted causal hypothesis.',
      score:before,
      relevance,
      contributions:arr(priorContributions)
    };
  }

  if(!(relevance>0)){
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

  return {
    accepted:true,
    rejected:false,
    reason:'',
    // Accepted causal evidence never lowers the committed hypothesis score.
    // A small numerical decrease within epsilon is treated as flat.
    score:Math.max(before,after),
    relevance,
    contributions:arr(priorContributions)
  };
}
