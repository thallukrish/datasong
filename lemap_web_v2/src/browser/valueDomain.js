import { resolveEntityLocator, createPageLocator } from '../execution/entityLocator.js';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueLabels(items = []) {
  return [...new Set(list(items).map((item) => String(item ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

async function nativeOptionLabels(locator) {
  if (typeof locator?.locator !== 'function') return [];
  const options = locator.locator('option');
  if (typeof options?.allTextContents !== 'function') return [];
  try {
    return uniqueLabels(await options.allTextContents());
  } catch {
    return [];
  }
}

async function visibleChoiceLabels(page) {
  if (typeof page?.getByRole !== 'function') return [];
  const options = page.getByRole('option');
  if (typeof options?.count !== 'function') return [];
  let count = 0;
  try {
    count = await options.count();
  } catch {
    return [];
  }
  const labels = [];
  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    try {
      if (await option.isVisible()) labels.push(await option.innerText());
    } catch {}
  }
  return uniqueLabels(labels);
}

export async function enumerateEntityValueDomain(page, entity = {}) {
  const known = uniqueLabels(entity?.structural?.values);
  if (known.length) return known;
  if (entity?.type !== 'ui_control' || entity.structural?.disabled === true) return [];

  const structural = entity.structural || {};
  const type = String(structural.controlType || '').toLowerCase();
  const tag = String(structural.tag || '').toLowerCase();
  const role = String(structural.role || '').toLowerCase();
  if (!(type === 'select' || tag === 'select' || tag === 'mat-select' || role === 'combobox')) return [];

  let locator;
  try {
    locator = createPageLocator(page, resolveEntityLocator(entity));
  } catch {
    return [];
  }

  const native = await nativeOptionLabels(locator);
  if (native.length) return native;
  if (typeof locator?.click !== 'function') return [];

  try {
    await locator.click({ timeout: 750 });
  } catch {
    if (!(await visibleChoiceLabels(page)).length) return [];
  }
  if (typeof page?.waitForTimeout === 'function') await page.waitForTimeout(50);
  const values = await visibleChoiceLabels(page);
  if (typeof page?.keyboard?.press === 'function') {
    try {
      await page.keyboard.press('Escape');
    } catch {}
  }
  return values;
}
