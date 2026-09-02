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
        if (!visible(el)) continue;
        if (found.includes(el)) continue;
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
    const byId = page.locator(`[id="${String(action.domId).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).first();
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
