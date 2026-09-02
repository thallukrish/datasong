function quoteAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function fieldLocator(page, field = {}) {
  if (field.domId) return page.locator(`[id="${quoteAttr(field.domId)}"]`).first();
  if (field.name && field.type === 'radio') return page.locator(`input[name="${quoteAttr(field.name)}"][value="${quoteAttr(field.value)}"]`).first();
  if (field.name) return page.locator(`[name="${quoteAttr(field.name)}"]`).first();
  if (field.label) return page.getByLabel(field.label, { exact: true }).first();
  throw new Error(`No locator evidence for ${field.id || field.label || 'field'}`);
}

export async function applyGroupAnswer(page, graph, question, interpretation) {
  const selected = new Set(interpretation.selectedFieldIds || []);
  const fields = (graph.fields || []).filter((field) => question.options?.some((option) => option.fieldId === field.id));
  if (question.cardinality === 'exactly_one') {
    const chosen = fields.find((field) => selected.has(field.id));
    if (!chosen) throw new Error('No valid option selected for exactly-one question');
    await fieldLocator(page, chosen).check();
    return;
  }
  for (const field of fields) {
    const locator = fieldLocator(page, field);
    if (selected.has(field.id)) await locator.check();
    else if (field.type === 'checkbox') await locator.uncheck();
  }
}

const BLOCKED_NAVIGATION = /\b(submit|verify|verification|pay|payment|delete|remove|logout|log out|file return|final submit)\b/i;
const ALLOWED_ROLES = new Set(['workflow_continuation', 'workflow_branch', 'related_entity']);

export function chooseExecutableNavigation(scores = [], candidates = []) {
  const byId = new Map((candidates || []).map((candidate) => [candidate.id, candidate]));
  for (const score of scores || []) {
    const candidate = byId.get(score.candidateId);
    if (!candidate || candidate.enabled === false || candidate.visible === false) continue;
    if (!ALLOWED_ROLES.has(score.role)) continue;
    if (BLOCKED_NAVIGATION.test(candidate.label || '')) continue;
    return { candidate, score };
  }
  return null;
}

export async function executeNavigationCandidate(page, candidate) {
  if (!candidate) throw new Error('Missing navigation candidate');
  if (BLOCKED_NAVIGATION.test(candidate.label || '')) throw new Error(`Blocked consequential navigation: ${candidate.label}`);
  if (candidate.kind === 'action') {
    const role = candidate.presentation?.role || 'button';
    if (role === 'button' || candidate.presentation?.tag === 'button') {
      await page.getByRole('button', { name: candidate.label, exact: true }).first().click();
      return;
    }
    await page.getByText(candidate.label, { exact: true }).first().click();
    return;
  }
  if (candidate.kind === 'link') {
    if (candidate.href) {
      const target = new URL(candidate.href, page.url());
      const current = new URL(page.url());
      if (target.origin !== current.origin) throw new Error(`Refusing cross-origin navigation to ${target.origin}`);
    }
    const locator = candidate.href
      ? page.locator(`a[href="${quoteAttr(candidate.href)}"]`).first()
      : page.getByRole('link', { name: candidate.label, exact: true }).first();
    await locator.click();
    return;
  }
  throw new Error(`Unsupported navigation candidate kind ${candidate.kind}`);
}
