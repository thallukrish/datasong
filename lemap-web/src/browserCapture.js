export function choosePage(pages = []) {
  const normal = pages.filter((page) => /^https?:/i.test(page?.url?.() || ''));
  return normal.at(-1) || pages.at(-1) || null;
}

export function summarizeBrowserEvent(event = {}) {
  return {
    kind: 'event',
    name: String(event.type || ''),
    tag: String(event.tag || '').toLowerCase(),
    label: String(event.label || ''),
    controlName: String(event.name || ''),
    value: event.value ?? null
  };
}

export function summarizeNetworkEvent(event = {}) {
  return {
    kind: 'network',
    phase: String(event.phase || ''),
    method: String(event.method || 'GET').toUpperCase(),
    url: String(event.url || ''),
    status: event.status ?? null
  };
}

export async function snapshotPage(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const interactiveRoles = new Set(['button', 'radio', 'checkbox', 'textbox', 'combobox', 'spinbutton', 'listbox']);
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const labelFor = (el) => {
      if (el.labels?.length) return clean(Array.from(el.labels).map((x) => x.innerText || x.textContent).join(' '));
      const aria = el.getAttribute?.('aria-label');
      if (aria) return clean(aria);
      const labelledBy = el.getAttribute?.('aria-labelledby');
      if (labelledBy) return clean(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' '));
      return clean(el.getAttribute?.('placeholder') || el.getAttribute?.('name') || el.id || '');
    };
    const regionLabel = (el) => {
      const aria = el.getAttribute?.('aria-label');
      if (aria) return clean(aria);
      const heading = el.querySelector?.(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > legend');
      if (heading) return clean(heading.innerText || heading.textContent);
      return '';
    };
    const optionsFor = (el) => {
      if (el.tagName?.toLowerCase() === 'select') return Array.from(el.options || []).map((option) => clean(option.value || option.textContent)).filter(Boolean);
      return [];
    };
    const control = (el) => ({
      control: true,
      tag: el.tagName.toLowerCase(),
      type: clean(el.type || ''),
      role: clean(el.getAttribute?.('role') || ''),
      domId: clean(el.id || ''),
      name: clean(el.name || el.id || ''),
      value: 'value' in el ? el.value : el.getAttribute?.('aria-valuenow') ?? null,
      label: labelFor(el),
      disabled: !!el.disabled || el.getAttribute?.('aria-disabled') === 'true',
      hidden: !visible(el),
      required: !!el.required || el.getAttribute?.('aria-required') === 'true',
      readonly: !!el.readOnly || el.getAttribute?.('aria-readonly') === 'true',
      placeholder: clean(el.getAttribute?.('placeholder') || ''),
      autocomplete: clean(el.getAttribute?.('autocomplete') || ''),
      min: el.getAttribute?.('min'),
      max: el.getAttribute?.('max'),
      step: el.getAttribute?.('step'),
      maxlength: el.getAttribute?.('maxlength'),
      pattern: el.getAttribute?.('pattern'),
      options: optionsFor(el)
    });
    const isControl = (el) => {
      const tag = el.tagName?.toLowerCase();
      const role = clean(el.getAttribute?.('role') || '').toLowerCase();
      return ['input', 'button', 'select', 'textarea'].includes(tag) || interactiveRoles.has(role);
    };

    // Framework wrappers are traversed transparently; labelled regions and
    // controls are retained as the structural UI hierarchy.
    const semanticChildren = (el, depth = 0) => {
      if (depth > 24) return [];
      const output = [];
      for (const child of Array.from(el.children || [])) {
        if (isControl(child)) {
          output.push(control(child));
          continue;
        }
        const nested = semanticChildren(child, depth + 1);
        const label = regionLabel(child);
        if (label) output.push({ tag: child.tagName?.toLowerCase() || 'div', label, hidden: !visible(child), children: nested });
        else output.push(...nested);
      }
      return output;
    };

    const pageLabel = clean(document.querySelector('h1')?.innerText || document.title || location.pathname);
    const root = document.querySelector('main,[role="main"]') || document.body;
    const dom = { tag: root.tagName.toLowerCase(), label: pageLabel, hidden: false, children: semanticChildren(root) };
    const values = {};
    for (const el of document.querySelectorAll('input,select,textarea,[role="combobox"],[role="spinbutton"]')) {
      if ((el.type || '').toLowerCase() === 'hidden') continue;
      const key = labelFor(el) || clean(el.name || el.id);
      if (!key) continue;
      if (el.type === 'radio') {
        if (el.checked) values[key] = el.value;
        else if (!(key in values)) values[key] = null;
      } else if (el.type === 'checkbox') values[key] = !!el.checked;
      else values[key] = 'value' in el ? el.value : el.getAttribute?.('aria-valuenow') ?? null;
    }
    const regions = {};
    for (const el of document.querySelectorAll('section,fieldset,[role="region"],div')) {
      const label = regionLabel(el);
      if (label) regions[label] = { visible: visible(el) };
    }
    return { page: pageLabel, url: location.href, title: document.title, dom, values, regions };
  });
}

export async function installUserEventProbe(page) {
  await page.evaluate(() => {
    window.__lemapWebEvents = [];
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const labelFor = (el) => {
      if (el?.labels?.length) return clean(Array.from(el.labels).map((x) => x.innerText || x.textContent).join(' '));
      return clean(el?.getAttribute?.('aria-label') || el?.getAttribute?.('placeholder') || el?.name || el?.id || '');
    };
    const handler = (event) => {
      const el = event.target;
      window.__lemapWebEvents.push({
        type: event.type,
        tag: el?.tagName || '',
        label: labelFor(el),
        name: el?.name || el?.id || '',
        value: 'value' in (el || {}) ? el.value : null,
        at: Date.now()
      });
    };
    for (const type of ['click', 'change', 'input', 'submit']) document.addEventListener(type, handler, true);
  });
}

export async function readUserEvents(page) {
  const events = await page.evaluate(() => Array.isArray(window.__lemapWebEvents) ? window.__lemapWebEvents : []);
  return events.map(summarizeBrowserEvent);
}
