function arr(value) { return Array.isArray(value) ? value : []; }
function normalize(value) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase(); }

function actionable(entity = {}) {
  return entity.type === 'ui_control'
    && ['button', 'link'].includes(String(entity.structural?.controlType || ''))
    && entity.structural?.visible !== false
    && entity.structural?.disabled !== true;
}

function routeFromUrl(value = '', base = '') {
  if (!value) return '';
  try {
    const url = new URL(value, base || undefined);
    const hashRoute = (url.hash || '').replace(/\?.*$/, '');
    return `${url.pathname}${hashRoute}` || '/';
  } catch {
    return String(value).split('?')[0];
  }
}

function pageFor(graph = [], id = '') {
  return arr(graph).find((entity) => entity.id === id && ['page', 'modal'].includes(entity.type)) || null;
}

function pageIdsForControl(entity = {}) {
  return arr(entity.links)
    .filter((link) => link.relationship === 'childOf')
    .map((link) => link.id);
}

function targetRouteForControl(entity = {}, currentPage = null) {
  const href = String(entity.structural?.href || '').trim();
  if (!href) return '';
  return routeFromUrl(href, currentPage?.structural?.url || '');
}

function earlierTrailPageIds(recentPageTrail = [], currentPageId = '') {
  const trail = arr(recentPageTrail).map((item) => String(item?.id || '')).filter(Boolean);
  const currentIndex = trail.lastIndexOf(String(currentPageId || ''));
  if (currentIndex <= 0) return [];
  return trail.slice(0, currentIndex);
}

function learnedEarlierTarget(entity = {}, earlierIds = []) {
  const earlier = new Set(earlierIds);
  return arr(entity.links)
    .filter((link) => link.relationship === 'transitionsTo')
    .map((link) => link.id)
    .find((id) => earlier.has(id)) || '';
}

function hrefEarlierTarget(entity = {}, graph = [], currentPage = null, earlierIds = []) {
  const route = targetRouteForControl(entity, currentPage);
  if (!route) return '';
  const matches = earlierIds.filter((id) => pageFor(graph, id)?.structural?.route === route);
  return matches.length === 1 ? matches[0] : '';
}

function globalLinkSignature(entity = {}, currentPage = null) {
  if (entity.structural?.controlType !== 'link') return '';
  const route = targetRouteForControl(entity, currentPage);
  if (!route) return '';
  return `link|${route}|${normalize(entity.name)}`;
}

function repeatedAcrossPages(entity = {}, graph = [], currentPage = null) {
  const signature = globalLinkSignature(entity, currentPage);
  if (!signature) return false;
  const pages = new Set();

  for (const candidate of arr(graph)) {
    if (candidate.type !== 'ui_control' || candidate.structural?.controlType !== 'link') continue;
    const parentPageId = pageIdsForControl(candidate)[0];
    if (!parentPageId) continue;
    const parentPage = pageFor(graph, parentPageId);
    if (!parentPage) continue;
    if (globalLinkSignature(candidate, parentPage) !== signature) continue;
    pages.add(parentPageId);
    if (pages.size >= 2) return true;
  }
  return false;
}

function deterministicPatch(id, workflowRole, relevantToGoal) {
  return {
    id,
    semantic: {
      interaction: 'navigation',
      relevantToGoal,
      required: false,
      workflowRole,
      navigationPriority: 0,
      consequence: 'reversible'
    }
  };
}

export function resolveNavigationTopology({
  entityGraph = [],
  currentEntities = [],
  currentPageId = '',
  recentPageTrail = []
} = {}) {
  const currentPage = arr(currentEntities).find((entity) => entity.id === currentPageId)
    || pageFor(entityGraph, currentPageId);
  const earlierIds = earlierTrailPageIds(recentPageTrail, currentPageId);
  const deterministicPatches = [];
  const modelCandidates = [];

  for (const entity of arr(currentEntities)) {
    if (!actionable(entity)) continue;

    const learnedBackTarget = learnedEarlierTarget(entity, earlierIds);
    const hrefBackTarget = learnedBackTarget ? '' : hrefEarlierTarget(entity, entityGraph, currentPage, earlierIds);
    if (learnedBackTarget || hrefBackTarget) {
      deterministicPatches.push(deterministicPatch(entity.id, 'back', true));
      continue;
    }

    if (repeatedAcrossPages(entity, entityGraph, currentPage)) {
      deterministicPatches.push(deterministicPatch(entity.id, 'global', false));
      continue;
    }

    modelCandidates.push(entity);
  }

  return { deterministicPatches, modelCandidates };
}
