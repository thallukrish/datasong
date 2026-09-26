const arr = (value) => Array.isArray(value) ? value : [];
const key = (value) => String(value || '').trim().toLowerCase();

export const WORKFLOW_CLASS_WEIGHTS = Object.freeze({
  core_end_user: 1.00,
  revenue_critical: 1.00,
  core_business: 0.90,
  operational: 0.75,
  support: 0.45,
  reporting: 0.30,
  admin: 0.12,
  configuration: 0.08,
  technical: 0.00
});

const FUNCTIONAL_CLASSES = new Set(['core_end_user','revenue_critical','core_business','operational']);
const SUPPORTING_CLASSES = new Set(['support','reporting']);
const TECHNICAL_CLASSES = new Set(['admin','configuration','technical']);
const FUNCTIONAL_ROLE_WEIGHTS = Object.freeze({ core:1.00, supporting:0.40, incidental:0.08, technical:0.00 });

function workflowSemantics(workflow) {
  const explicit = key(workflow?.data?.functionalRole);
  if (Object.hasOwn(FUNCTIONAL_ROLE_WEIGHTS, explicit)) {
    return {
      source:'functionalRole',
      role:explicit === 'core' ? 'functional' : explicit,
      weight:FUNCTIONAL_ROLE_WEIGHTS[explicit]
    };
  }
  const cls = key(workflow?.data?.priorityClass);
  if (FUNCTIONAL_CLASSES.has(cls)) return { source:'priorityClass', role:'functional', weight:WORKFLOW_CLASS_WEIGHTS[cls] ?? 0.75 };
  if (SUPPORTING_CLASSES.has(cls)) return { source:'priorityClass', role:'supporting', weight:WORKFLOW_CLASS_WEIGHTS[cls] ?? 0.35 };
  if (TECHNICAL_CLASSES.has(cls)) return { source:'priorityClass', role:'technical', weight:WORKFLOW_CLASS_WEIGHTS[cls] ?? 0 };
  return { source:'fallback', role:'unclassified', weight:0.20 };
}

function nodeMap(graph) {
  return new Map(arr(graph).filter((node) => node?.id).map((node) => [node.id, node]));
}

function outgoing(node, nodes, relationship = '') {
  return arr(node?.links)
    .filter((link) => !relationship || link?.relationship === relationship)
    .map((link) => ({ link, node:nodes.get(link?.nodeId) }))
    .filter((item) => item.node);
}

function relationStrength(link = {}) {
  const kind = key(link?.data?.relationshipKind);
  if (kind === 'schema_fk' && arr(link?.data?.keyMaps).length) return 1;
  if (kind === 'schema_fk') return 0.85;
  if (kind === 'schema_reference') return 0.5;
  return 0.65;
}

function uniqueEntityRelations(graph, nodes) {
  const seen = new Set();
  const relations = [];
  for (const from of arr(graph).filter((node) => node?.type === 'entity')) {
    for (const link of arr(from.links)) {
      const to = nodes.get(link?.nodeId);
      if (to?.type !== 'entity') continue;
      const a = from.id < to.id ? from.id : to.id;
      const b = from.id < to.id ? to.id : from.id;
      const sig = `${a}|${b}|${key(link.relationship)}|${key(link?.data?.relationshipKind)}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      relations.push({ from, to, link, strength:relationStrength(link) });
    }
  }
  return relations;
}

function round(value) {
  return Number(Number(value || 0).toFixed(3));
}

function classifyEntityRole(stats) {
  const functional = stats.functionalWorkflowCount;
  const supporting = stats.supportingWorkflowCount;
  const technical = stats.technicalWorkflowCount;
  const total = functional + supporting + technical + stats.incidentalWorkflowCount + stats.unclassifiedWorkflowCount;
  const stage = stats.businessStageCount;
  const degree = stats.relationshipDegree;
  const functionalShare = total ? functional / total : 0;
  const technicalShare = total ? technical / total : 0;

  // Functional requires repeated business use, or one functional workflow plus
  // meaningful direct stage participation. One incidental workflow is not enough.
  if (functional >= 2 && functionalShare >= 0.5 && stage >= 1) return 'functional';
  if (functional >= 1 && stage >= 3 && technicalShare < 0.34) return 'functional';

  if (functional > 0 && technical > 0 && technicalShare >= 0.34) return 'mixed';
  if (supporting >= 1 && functional === 0 && technicalShare < 0.5) return 'supporting';
  if (technical >= 1 && functional === 0 && supporting === 0) return 'technical';

  // Highly connected objects with weak direct business participation are helpers.
  if (stage === 0 && degree >= 3) return 'helper';
  if (functional + supporting === 0 && degree >= 2) return 'helper';
  if (supporting > 0) return 'supporting';
  return 'unclassified';
}

function roleMultiplier(role) {
  switch (role) {
    case 'functional': return 1.0;
    case 'mixed': return 0.60;
    case 'supporting': return 0.50;
    case 'unclassified': return 0.35;
    case 'helper': return 0.15;
    case 'technical': return 0.05;
    default: return 0.35;
  }
}

export function rankCoreEntities(graph = [], { limit = 25 } = {}) {
  const nodes = nodeMap(graph);
  const entities = arr(graph).filter((node) => node?.type === 'entity');
  const workflows = arr(graph).filter((node) => node?.type === 'workflow');
  const statsById = new Map(entities.map((entity) => [entity.id, {
    entity:entity.name || entity.id,
    entityId:entity.id,
    description:String(entity?.data?.description || ''),
    schemaResolved:entity?.data?.schemaResolved === true,
    workflowIds:new Set(),
    workflowTitles:new Set(),
    functionalWorkflowCount:0,
    supportingWorkflowCount:0,
    technicalWorkflowCount:0,
    incidentalWorkflowCount:0,
    unclassifiedWorkflowCount:0,
    weightedWorkflowScore:0,
    businessStageCount:0,
    stageRefs:new Set(),
    relationshipDegree:0,
    evidencedRelationshipDegree:0,
    relationshipStrength:0,
    crossWorkflowNeighbourCount:0,
    neighbourIds:new Set()
  }]));

  const workflowEntities = new Map();
  for (const workflow of workflows) {
    const semantics = workflowSemantics(workflow);
    const role = semantics.role;
    const weight = semantics.weight;
    const used = outgoing(workflow, nodes, 'uses entity').filter((item) => item.node.type === 'entity').map((item) => item.node);
    const usedIds = new Set(used.map((entity) => entity.id));
    workflowEntities.set(workflow.id, usedIds);

    for (const entity of used) {
      const stats = statsById.get(entity.id);
      if (!stats) continue;
      stats.workflowIds.add(workflow.id);
      stats.workflowTitles.add(workflow.name || workflow.id);
      stats.weightedWorkflowScore += weight;
      if (role === 'functional') stats.functionalWorkflowCount += 1;
      else if (role === 'supporting') stats.supportingWorkflowCount += 1;
      else if (role === 'technical') stats.technicalWorkflowCount += 1;
      else if (role === 'incidental') stats.incidentalWorkflowCount += 1;
      else stats.unclassifiedWorkflowCount += 1;
    }

    const steps = outgoing(workflow, nodes, 'contains step').filter((item) => item.node.type === 'step').map((item) => item.node);
    for (const step of steps) {
      for (const item of outgoing(step, nodes, 'touches entity').filter((item) => item.node.type === 'entity')) {
        const stats = statsById.get(item.node.id);
        if (!stats) continue;
        const stageRef = `${workflow.id}:${step.id}`;
        if (stats.stageRefs.has(stageRef)) continue;
        stats.stageRefs.add(stageRef);
        if (role === 'functional' || role === 'supporting') stats.businessStageCount += 1;
      }
    }
  }

  const relations = uniqueEntityRelations(graph, nodes);
  for (const rel of relations) {
    for (const [self, other] of [[rel.from, rel.to], [rel.to, rel.from]]) {
      const stats = statsById.get(self.id);
      if (!stats) continue;
      stats.relationshipDegree += 1;
      stats.relationshipStrength += rel.strength;
      if (rel.strength >= 0.85) stats.evidencedRelationshipDegree += 1;
      stats.neighbourIds.add(other.id);
    }
  }

  // Cross-workflow neighbours approximate business hand-offs. They are counted
  // only when both entities participate in workflows and their workflow sets differ.
  for (const stats of statsById.values()) {
    const own = stats.workflowIds;
    if (!own.size) continue;
    for (const neighbourId of stats.neighbourIds) {
      const neighbour = statsById.get(neighbourId);
      if (!neighbour?.workflowIds?.size) continue;
      const same = own.size === neighbour.workflowIds.size && [...own].every((id) => neighbour.workflowIds.has(id));
      if (!same) stats.crossWorkflowNeighbourCount += 1;
    }
  }

  const ranked = [...statsById.values()].map((stats) => {
    const role = classifyEntityRole(stats);
    // Workflow semantics dominate. Connectivity only refines the ranking.
    const workflowScore = stats.weightedWorkflowScore * 5;
    const stageScore = Math.min(stats.businessStageCount, 10) * 2;

    // Raw degree can explode for generic ERP hub entities, so both connectivity
    // signals are deliberately logarithmic and capped.
    const relationshipScore = Math.min(Math.log2(1 + stats.relationshipDegree), 5) * 1.25;
    const handoffScore = Math.min(Math.log2(1 + stats.crossWorkflowNeighbourCount), 4) * 1.5;

    // Strongly evidenced FK relationships are useful, but only as a small bonus.
    const evidenceBonus = Math.min(stats.evidencedRelationshipDegree, 5) * 0.75;
    const schemaBonus = stats.schemaResolved ? 0.5 : 0;
    const rawCoreScore = workflowScore + stageScore + relationshipScore + handoffScore + evidenceBonus + schemaBonus;
    const coreScore = rawCoreScore * roleMultiplier(role);

    const reasons = [];
    if (stats.functionalWorkflowCount) reasons.push(`${stats.functionalWorkflowCount} functional workflow(s)`);
    if (stats.supportingWorkflowCount) reasons.push(`${stats.supportingWorkflowCount} supporting workflow(s)`);
    if (stats.technicalWorkflowCount) reasons.push(`${stats.technicalWorkflowCount} technical workflow(s)`);
    if (stats.incidentalWorkflowCount) reasons.push(`${stats.incidentalWorkflowCount} incidental workflow(s)`);
    if (stats.businessStageCount) reasons.push(`${stats.businessStageCount} business workflow stage(s)`);
    if (stats.relationshipDegree) reasons.push(`${stats.relationshipDegree} entity relationship(s)`);
    if (stats.evidencedRelationshipDegree) reasons.push(`${stats.evidencedRelationshipDegree} strongly evidenced relationship(s)`);
    if (stats.crossWorkflowNeighbourCount) reasons.push(`${stats.crossWorkflowNeighbourCount} cross-workflow neighbour(s)`);
    if (role === 'helper') reasons.push('high schema connectivity relative to direct business workflow participation');

    return {
      entity:stats.entity,
      entityId:stats.entityId,
      role,
      coreScore:round(coreScore),
      rawCoreScore:round(rawCoreScore),
      workflowScore:round(workflowScore),
      stageScore:round(stageScore),
      relationshipScore:round(relationshipScore),
      handoffScore:round(handoffScore),
      evidenceBonus:round(evidenceBonus),
      workflowCount:stats.workflowIds.size,
      functionalWorkflowCount:stats.functionalWorkflowCount,
      supportingWorkflowCount:stats.supportingWorkflowCount,
      technicalWorkflowCount:stats.technicalWorkflowCount,
      incidentalWorkflowCount:stats.incidentalWorkflowCount,
      businessStageCount:stats.businessStageCount,
      relationshipDegree:stats.relationshipDegree,
      evidencedRelationshipDegree:stats.evidencedRelationshipDegree,
      crossWorkflowNeighbourCount:stats.crossWorkflowNeighbourCount,
      schemaResolved:stats.schemaResolved,
      workflows:[...stats.workflowTitles].sort(),
      description:stats.description,
      reasons
    };
  }).sort((a,b) => b.coreScore - a.coreScore || b.functionalWorkflowCount - a.functionalWorkflowCount || b.relationshipDegree - a.relationshipDegree || a.entity.localeCompare(b.entity));

  return ranked.slice(0, Math.max(0, Number(limit) || 0));
}
