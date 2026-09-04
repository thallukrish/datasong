function arr(value) { return Array.isArray(value) ? value : []; }
function quoteAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function normalize(value) { return String(value ?? '').trim().toLowerCase(); }

function locatorForEntity(page, entity = {}) {
  const structural = entity.structural || {};
  if (structural.domId) return page.locator(`[id="${quoteAttr(structural.domId)}"]`).first();
  if (structural.name && structural.controlType === 'radio' && structural.value !== null && structural.value !== undefined) {
    return page.locator(`input[name="${quoteAttr(structural.name)}"][value="${quoteAttr(structural.value)}"]`).first();
  }
  if (structural.name) return page.locator(`[name="${quoteAttr(structural.name)}"]`).first();
  if (entity.name) return page.getByLabel(entity.name, { exact: true }).first();
  throw new Error(`No locator evidence for ${entity.id || entity.name || 'entity'}`);
}

export function entityInteractionKind(entity = {}) {
  const structural = entity.structural || {};
  const tag = String(structural.tag || '').toLowerCase();
  const role = String(structural.role || '').toLowerCase();
  if (tag === 'mat-select' || role === 'combobox') return 'combobox';
  if (tag === 'select' || structural.controlType === 'select') return 'native_select';
  if (structural.controlType === 'radio') return 'radio';
  if (structural.controlType === 'checkbox') return 'checkbox';
  if (structural.controlType === 'button') return 'button';
  if (structural.controlType === 'link') return 'link';
  return 'fillable';
}

export function memberEntityForGroupValue(entities = [], group = {}, value = '') {
  const byId = new Map(arr(entities).map((entity) => [entity.id, entity]));
  const wanted = normalize(value);
  return arr(group.links)
    .filter((link) => link.relationship === 'contains')
    .map((link) => byId.get(link.id))
    .find((member) => member && [member.name, member.structural?.value].some((candidate) => normalize(candidate) === wanted)) || null;
}

async function chooseComboboxOption(page, locator, value) {
  await locator.click();
  const wanted = String(value).trim();
  const exact = page.getByRole('option', { name: wanted, exact: true }).first();
  if (await exact.count()) {
    await exact.click();
    return;
  }
  throw new Error(`Could not find combobox option matching "${wanted}"`);
}

async function applyControlValue(page, entity, value) {
  const locator = locatorForEntity(page, entity);
  const interaction = entityInteractionKind(entity);
  if (interaction === 'combobox') return chooseComboboxOption(page, locator, value);
  if (interaction === 'native_select') {
    await locator.selectOption({ value: String(value) }).catch(async () => locator.selectOption({ label: String(value) }));
    return;
  }
  if (interaction === 'radio') {
    if (await locator.isChecked().catch(() => false)) await locator.click();
    else await locator.check();
    return;
  }
  if (interaction === 'checkbox') {
    if (value === false || normalize(value) === 'false' || normalize(value) === 'no') await locator.uncheck();
    else await locator.check();
    return;
  }
  if (interaction === 'button' || interaction === 'link') {
    await locator.click();
    return;
  }
  await locator.fill(String(value));
  if (entity.structural?.controlType === 'autocomplete') await locator.press('Tab');
}

export async function applyEntityValue(page, entities = [], entity = {}, value = null) {
  if (entity.type !== 'group') return applyControlValue(page, entity, value);
  const groupType = entity.structural?.groupType;
  if (groupType === 'radio') {
    const member = memberEntityForGroupValue(entities, entity, value);
    if (!member) throw new Error(`Could not map group value "${value}" for ${entity.name}`);
    return applyControlValue(page, member, true);
  }
  if (groupType === 'checkbox') {
    const wanted = new Set(arr(value).map(normalize));
    for (const link of arr(entity.links).filter((item) => item.relationship === 'contains')) {
      const member = arr(entities).find((candidate) => candidate.id === link.id);
      if (!member) continue;
      const selected = wanted.has(normalize(member.name)) || wanted.has(normalize(member.structural?.value));
      await applyControlValue(page, member, selected);
    }
    return;
  }
  throw new Error(`Unsupported group type ${groupType || 'unknown'}`);
}

export async function executeEntityAction(page, entity = {}) {
  const structural = entity.structural || {};
  if (structural.controlType === 'link' && structural.href) {
    const current = new URL(page.url());
    const target = new URL(structural.href, page.url());
    if (target.origin !== current.origin) throw new Error(`Refusing cross-origin navigation to ${target.origin}`);
  }
  const locator = locatorForEntity(page, entity);
  await locator.click();
}
