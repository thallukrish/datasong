function clean(value) {
  return String(value ?? '').trim();
}

function escapeCssAttribute(value) {
  return clean(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeCssId(value) {
  return clean(value).replace(/([#.;:[\],>+~*'"\\])/g, '\\$1');
}

export function resolveEntityLocator(entity = {}) {
  if (entity?.type !== 'ui_control') {
    throw new Error('resolveEntityLocator requires a ui_control entity.');
  }

  const structural = entity.structural || {};
  const domId = clean(structural.domId);
  if (domId) {
    return {
      strategy: 'css',
      selector: `#${escapeCssId(domId)}`
    };
  }

  const name = clean(structural.name);
  if (name) {
    return {
      strategy: 'css',
      selector: `[name="${escapeCssAttribute(name)}"]`
    };
  }

  const label = clean(structural.label || entity.name);
  if (label) {
    return {
      strategy: 'label',
      label
    };
  }

  throw new Error(`No stable locator anchor available for entity ${entity.id || ''}`.trim());
}

export function createPageLocator(page, locatorSpec) {
  if (!page) throw new Error('page is required.');
  if (!locatorSpec) throw new Error('locator specification is required.');

  if (locatorSpec.strategy === 'css') {
    if (typeof page.locator !== 'function') throw new Error('page.locator() is required.');
    return page.locator(locatorSpec.selector);
  }

  if (locatorSpec.strategy === 'label') {
    if (typeof page.getByLabel === 'function') {
      return page.getByLabel(locatorSpec.label);
    }
    if (typeof page.locator === 'function') {
      return page.locator(`[aria-label="${escapeCssAttribute(locatorSpec.label)}"]`);
    }
    throw new Error('A label-capable page locator is required.');
  }

  throw new Error(`Unsupported locator strategy: ${locatorSpec.strategy}`);
}
