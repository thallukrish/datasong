import { resolveEntityLocator, createPageLocator } from '../execution/entityLocator.js';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueLabels(items = []) {
  return [...new Set(list(items).map((item) => String(item ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean))];
}

export async function enumerateEntityValueDomain(page, entity = {}) {
  const known = uniqueLabels(entity?.structural?.values);
  if (known.length) return known;
  if (entity?.type !== 'ui_control' || entity.structural?.disabled === true) return [];
  if (String(entity.structural?.controlType || '').toLowerCase() !== 'select') return [];

  let locator;
  try {
    locator = createPageLocator(page, resolveEntityLocator(entity));
  } catch {
    return [];
  }
  if (typeof locator?.locator !== 'function') return [];
  const options = locator.locator('option');
  if (typeof options?.allTextContents !== 'function') return [];
  try {
    return uniqueLabels(await options.allTextContents());
  } catch {
    return [];
  }
}
