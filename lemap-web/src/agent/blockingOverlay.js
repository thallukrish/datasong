import { planOverlayResolution } from '../semantic/overlayPlanner.js';

function arr(value) { return Array.isArray(value) ? value : []; }
function clean(value, max = 900) {
  const s = String(value || '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function normalizeOverlaySnapshot(raw = {}) {
  const actions = arr(raw.actions)
    .filter((action) => action && action.visible !== false)
    .map((action, index) => ({
      id: `overlay-action:${index}`,
      label: clean(action.label, 180),
      disabled: !!action.disabled,
      domId: clean(action.domId, 180),
      name: clean(action.name, 180)
    }))
    .filter((action) => action.label && !action.disabled);
  return {
    title: clean(raw.title, 220),
    text: clean(raw.text, 1200),
    selectorHint: clean(raw.selectorHint, 160),
    actions
  };
}

export async function findBlockingOverlay(page) {
  const raw = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      if (!el) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      'mat-dialog-container',
      '.mat-mdc-dialog-container',
      'ngb-modal-window',
      '.modal.show',
      '.modal.in',
      'app-notification-popup'
    ];
    const found = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || found.includes(el)) continue;
        const buttons = Array.from(el.querySelectorAll('button,[role="button"]')).filter(visible);
        const text = clean(el.innerText || el.textContent || '');
        if (!buttons.length || text.length < 8) continue;
        found.push(el);
      }
    }
    if (!found.length) return null;
    found.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.width * br.height) - (ar.width * ar.height);
    });
    const el = found[0];
    const heading = el.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]');
    const actions = Array.from(el.querySelectorAll('button,[role="button"]')).filter(visible).map((button) => ({
      label: clean(button.getAttribute('aria-label') || button.innerText || button.textContent || button.getAttribute('title') || button.id || button.getAttribute('name') || ''),
      disabled: !!button.disabled || button.getAttribute('aria-disabled') === 'true',
      visible: true,
      domId: clean(button.id || ''),
      name: clean(button.getAttribute('name') || '')
    }));
    return {
      title: clean(heading?.innerText || heading?.textContent || ''),
      text: clean(el.innerText || el.textContent || ''),
      selectorHint: selectors.find((selector) => { try { return el.matches(selector); } catch { return false; } }) || '',
      actions
    };
  });
  return raw ? normalizeOverlaySnapshot(raw) : null;
}

export async function executeOverlayAction(page, overlay, actionId) {
  const action = arr(overlay?.actions).find((item) => item.id === actionId);
  if (!action) throw new Error(`Unknown overlay action ${actionId}`);
  if (action.domId) {
    const escaped = String(action.domId).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const byId = page.locator(`[id="${escaped}"]`).first();
    if (await byId.count()) { await byId.click(); return; }
  }
  const selectors = ['[role="dialog"]','[aria-modal="true"]','mat-dialog-container','.mat-mdc-dialog-container','ngb-modal-window','.modal.show','.modal.in','app-notification-popup'];
  for (const selector of selectors) {
    const roots = page.locator(selector);
    const count = await roots.count();
    for (let i = 0; i < count; i += 1) {
      const root = roots.nth(i);
      if (!(await root.isVisible().catch(() => false))) continue;
      const button = root.getByRole('button', { name: action.label, exact: true }).first();
      if (await button.count()) { await button.click(); return; }
      const byText = root.getByText(action.label, { exact: true }).first();
      if (await byText.count()) { await byText.click(); return; }
    }
  }
  throw new Error(`Could not locate overlay action ${action.label}`);
}

export async function resolveBlockingOverlays({
  page,
  client,
  model,
  userGoal = '',
  settleMs = 300,
  askUser = async () => '',
  onEvent = async () => {}
} = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const overlay = await findBlockingOverlay(page);
    if (!overlay) return { resolved: true, count: attempt };
    await onEvent('detected', {
      title: overlay.title,
      text: overlay.text,
      actions: overlay.actions.map((action) => ({ id: action.id, label: action.label }))
    });

    let plan = await planOverlayResolution({ client, model, userGoal, overlay });
    await onEvent('plan', plan);
    if (plan.decision === 'ask_user') {
      const response = await askUser(plan.question);
      if (!String(response || '').trim()) return { resolved: false, reason: 'overlay_user_answer_missing' };
      plan = await planOverlayResolution({ client, model, userGoal, overlay, userResponse: response });
      await onEvent('plan_after_user', { ...plan, userAnswer: 'provided' });
    }

    if (plan.decision !== 'act') return { resolved: false, reason: plan.reason || 'overlay_not_resolved' };
    const action = overlay.actions.find((candidate) => candidate.id === plan.actionId);
    await onEvent('action', { actionId: plan.actionId, label: action?.label || '', reason: plan.reason, confidence: plan.confidence });
    await executeOverlayAction(page, overlay, plan.actionId);
    if (settleMs > 0) await page.waitForTimeout(settleMs);
  }
  return { resolved: false, reason: 'too_many_blocking_overlays' };
}
