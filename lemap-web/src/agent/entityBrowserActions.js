function arr(value) { return Array.isArray(value) ? value : []; }
function quoteAttr(value) { return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function normalize(value) { return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase(); }

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function locatorForEntity(page, entity = {}) {
  const structural = entity.structural || {};
  let locator = null;

  if (structural.domId) {
    locator = await firstVisible(page.locator(`[id="${quoteAttr(structural.domId)}"]`));
    if (locator) return locator;
  }
  if (structural.name && structural.controlType === 'radio' && structural.value !== null && structural.value !== undefined) {
    locator = await firstVisible(page.locator(`input[name="${quoteAttr(structural.name)}"][value="${quoteAttr(structural.value)}"]`));
    if (locator) return locator;
  }
  if (structural.name) {
    locator = await firstVisible(page.locator(`[name="${quoteAttr(structural.name)}"]`));
    if (locator) return locator;
  }
  if (entity.name && structural.controlType === 'button') {
    locator = await firstVisible(page.getByRole('button', { name: entity.name, exact: true }));
    if (locator) return locator;
  }
  if (entity.name && structural.controlType === 'link') {
    locator = await firstVisible(page.getByRole('link', { name: entity.name, exact: true }));
    if (locator) return locator;
  }
  if (entity.name) {
    locator = await firstVisible(page.getByLabel(entity.name, { exact: true }));
    if (locator) return locator;
  }
  throw new Error(`No visible locator match for ${entity.id || entity.name || 'entity'}`);
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

export function optionCandidateMatches(candidate = {}, value = '') {
  const wanted = normalize(value);
  return [candidate.text, candidate.ariaLabel, candidate.dataValue, candidate.value]
    .some((item) => normalize(item) === wanted);
}

async function chooseComboboxOption(page, locator, value) {
  await locator.click();
  const wanted = String(value).trim();
  const options = page.locator('[role="option"],mat-option');
  const count = await options.count();

  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    if (!await option.isVisible().catch(() => false)) continue;
    const candidate = await option.evaluate((element) => ({
      text: element.innerText || element.textContent || '',
      ariaLabel: element.getAttribute?.('aria-label') || '',
      dataValue: element.getAttribute?.('data-value') || '',
      value: element.getAttribute?.('value') || ''
    })).catch(() => ({}));
    if (!optionCandidateMatches(candidate, wanted)) continue;
    await option.click();
    return;
  }

  throw new Error(`Could not find combobox option matching "${wanted}"`);
}

async function applyControlValue(page, entity, value) {
  const locator = await locatorForEntity(page, entity);
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
  if (groupType === 'radio' || groupType === 'choice') {
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
  const locator = await locatorForEntity(page, entity);
  await locator.click();
}
