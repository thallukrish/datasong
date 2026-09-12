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

function locatorStrategy(spec = null) {
  if (!spec) return 'none';
  if (spec.strategy === 'css') {
    return String(spec.selector || '').startsWith('#') ? 'domId' : 'name';
  }
  if (spec.strategy === 'label') return 'label';
  return String(spec.strategy || 'unknown');
}

async function report(onProbe, probe) {
  if (typeof onProbe === 'function') await onProbe({ ...probe });
}

export async function enumerateEntityValueDomain(page, entity = {}, { onProbe = null } = {}) {
  const known = uniqueLabels(entity?.structural?.values);
  if (known.length) return known;
  if (entity?.type !== 'ui_control' || entity.structural?.disabled === true) return [];

  const structural = entity.structural || {};
  const type = String(structural.controlType || '').toLowerCase();
  const tag = String(structural.tag || '').toLowerCase();
  const role = String(structural.role || '').toLowerCase();
  if (!(type === 'select' || tag === 'select' || tag === 'mat-select' || role === 'combobox')) return [];

  const probe = {
    entityId: String(entity.id || ''),
    controlType: type,
    tag,
    role,
    hasDomId: !!String(structural.domId || '').trim(),
    hasName: !!String(structural.name || '').trim(),
    hasLabel: !!String(structural.label || entity.name || '').trim(),
    locatorStrategy: 'none',
    locatorResolved: false,
    nativeOptionCount: 0,
    opened: false,
    visibleOptionCount: 0
  };

  let locator;
  try {
    const spec = resolveEntityLocator(entity);
    probe.locatorStrategy = locatorStrategy(spec);
    locator = createPageLocator(page, spec);
    probe.locatorResolved = !!locator;
  } catch {
    await report(onProbe, probe);
    return [];
  }

  const native = await nativeOptionLabels(locator);
  probe.nativeOptionCount = native.length;
  if (native.length) {
    await report(onProbe, probe);
    return native;
  }
  if (typeof locator?.click !== 'function') {
    await report(onProbe, probe);
    return [];
  }

  try {
    await locator.click({ timeout: 750 });
    probe.opened = true;
  } catch {
    const alreadyVisible = await visibleChoiceLabels(page);
    probe.visibleOptionCount = alreadyVisible.length;
    if (!alreadyVisible.length) {
      await report(onProbe, probe);
      return [];
    }
  }
  if (typeof page?.waitForTimeout === 'function') await page.waitForTimeout(50);
  const values = await visibleChoiceLabels(page);
  probe.visibleOptionCount = values.length;
  if (typeof page?.keyboard?.press === 'function') {
    try {
      await page.keyboard.press('Escape');
    } catch {}
  }
  await report(onProbe, probe);
  return values;
}
