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
      const heading = el.querySelector?.(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > legend');
      if (heading) return clean(heading.innerText || heading.textContent);
      return '';
    };
    const control = (el) => ({
      tag: el.tagName.toLowerCase(),
      type: clean(el.type || ''),
      name: clean(el.name || el.id || ''),
      value: 'value' in el ? el.value : null,
      label: labelFor(el),
      disabled: !!el.disabled,
      hidden: !visible(el)
    });
    const region = (el, depth = 0) => {
      const children = [];
      for (const child of Array.from(el.children || [])) {
        const tag = child.tagName?.toLowerCase();
        if (['input', 'button', 'select', 'textarea'].includes(tag)) {
          children.push(control(child));
          continue;
        }
        const label = regionLabel(child);
        const hasControls = !!child.querySelector?.('input,button,select,textarea');
        if ((label || hasControls) && depth < 5) {
          children.push({ tag: tag || 'div', label, hidden: !visible(child), children: region(child, depth + 1).children });
        }
      }
      return { children };
    };
    const pageLabel = clean(document.querySelector('h1')?.innerText || document.title || location.pathname);
    const root = document.querySelector('main,[role="main"]') || document.body;
    const dom = { tag: root.tagName.toLowerCase(), label: pageLabel, hidden: false, children: region(root).children };
    const values = {};
    for (const el of document.querySelectorAll('input,select,textarea')) {
      const key = labelFor(el) || clean(el.name || el.id);
      if (!key) continue;
      if (el.type === 'radio') {
        if (el.checked) values[key] = el.value;
        else if (!(key in values)) values[key] = null;
      } else if (el.type === 'checkbox') values[key] = !!el.checked;
      else values[key] = el.value;
    }
    const regions = {};
    for (const el of document.querySelectorAll('section,fieldset,[role="region"],div')) {
      const label = regionLabel(el);
      if (label) regions[label] = { visible: visible(el) };
    }
    return {
      page: pageLabel,
      url: location.href,
      title: document.title,
      dom,
      values,
      regions
    };
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
