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
    const interactiveRoles = new Set(['button', 'radio', 'checkbox', 'textbox', 'combobox', 'spinbutton', 'listbox', 'link']);
    const rendered = (el) => {
      const style = getComputedStyle(el);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.visibility !== 'collapse'
        && !el.hasAttribute('hidden')
        && el.getAttribute?.('aria-hidden') !== 'true';
    };
    const visible = (el) => {
      if (!rendered(el)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const textWithoutControls = (el) => {
      if (!el) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll?.('input,select,textarea,button,a,[role="button"],[role="link"],[role="radio"],[role="checkbox"],[role="textbox"],[role="combobox"],[role="spinbutton"],[role="listbox"],option').forEach((node) => node.remove());
      return clean(clone.textContent || '');
    };
    const labelFor = (el) => {
      const associated = el.labels?.length ? Array.from(el.labels) : [];
      const closest = el.closest?.('label');
      if (closest && !associated.includes(closest)) associated.push(closest);
      const associatedText = clean(associated.map(textWithoutControls).filter(Boolean).join(' '));
      if (associatedText) return associatedText;
      const aria = el.getAttribute?.('aria-label');
      if (aria) return clean(aria);
      const labelledBy = el.getAttribute?.('aria-labelledby');
      if (labelledBy) {
        const text = clean(labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '').join(' '));
        if (text) return text;
      }
      const tag = el.tagName?.toLowerCase();
      const role = clean(el.getAttribute?.('role') || '').toLowerCase();
      if (tag === 'button' || role === 'button' || tag === 'a' || role === 'link') {
        const controlText = clean(el.innerText || el.textContent);
        if (controlText) return controlText;
      }
      return clean(el.getAttribute?.('placeholder') || el.getAttribute?.('title') || el.getAttribute?.('name') || el.id || '');
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
    const defaultValueFor = (el) => {
      const tag = el.tagName?.toLowerCase();
      if (tag === 'select') {
        const options = Array.from(el.options || []);
        const selected = options.find((option) => option.defaultSelected) || options[0] || null;
        return selected ? clean(selected.value || selected.textContent) : null;
      }
      if ('defaultValue' in el) return el.defaultValue;
      return null;
    };
    const control = (el) => {
      const type = clean(el.type || '').toLowerCase();
      return {
        control: true,
        tag: el.tagName.toLowerCase(),
        type,
        role: clean(el.getAttribute?.('role') || ''),
        domId: clean(el.id || ''),
        name: clean(el.name || el.id || ''),
        href: clean(el.getAttribute?.('href') || ''),
        value: 'value' in el ? el.value : el.getAttribute?.('aria-valuenow') ?? null,
        defaultValue: defaultValueFor(el),
        checked: ['radio', 'checkbox'].includes(type) ? !!el.checked : null,
        defaultChecked: ['radio', 'checkbox'].includes(type) ? !!el.defaultChecked : null,
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
      };
    };
    const isControl = (el) => {
      const tag = el.tagName?.toLowerCase();
      const role = clean(el.getAttribute?.('role') || '').toLowerCase();
      return ['input', 'button', 'select', 'textarea'].includes(tag)
        || (tag === 'a' && !!el.getAttribute?.('href'))
        || interactiveRoles.has(role);
    };
    const semanticChildren = (el, depth = 0) => {
      if (depth > 24) return [];
      const output = [];
      for (const child of Array.from(el.children || [])) {
        if (isControl(child)) {
          if (rendered(child)) output.push(control(child));
          continue;
        }
        const nested = semanticChildren(child, depth + 1);
        const label = regionLabel(child);
        if (label && rendered(child)) output.push({ tag: child.tagName?.toLowerCase() || 'div', label, hidden: !visible(child), children: nested });
        else output.push(...nested);
      }
      return output;
    };

    const overlaySelectors = ['[role="dialog"]','[aria-modal="true"]','mat-dialog-container','.mat-mdc-dialog-container','ngb-modal-window','.modal.show','.modal.in','app-notification-popup'];
    const overlayCandidates = [];
    for (const selector of overlaySelectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!visible(el) || overlayCandidates.includes(el)) continue;
        const buttons = Array.from(el.querySelectorAll('button,[role="button"]')).filter(visible);
        const text = clean(el.innerText || el.textContent || '');
        if (!buttons.length || text.length < 8) continue;
        overlayCandidates.push(el);
      }
    }
    overlayCandidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.width * br.height) - (ar.width * ar.height);
    });
    const blockingOverlay = overlayCandidates[0] || null;
    const normalRoot = document.body;
    const root = blockingOverlay || normalRoot;
    const overlayText = blockingOverlay ? clean(blockingOverlay.innerText || blockingOverlay.textContent || '') : '';
    const overlayHeading = blockingOverlay?.querySelector?.('h1,h2,h3,h4,h5,h6,[role="heading"]');
    const pageLabel = blockingOverlay
      ? clean(overlayHeading?.innerText || overlayHeading?.textContent || overlayText.slice(0, 220) || 'Blocking dialog')
      : clean(document.querySelector('h1')?.innerText || document.title || location.pathname);
    const dom = { tag: root.tagName.toLowerCase(), label: pageLabel, hidden: false, children: semanticChildren(root) };
    const scope = blockingOverlay || document;

    const values = {};
    for (const el of scope.querySelectorAll('input,select,textarea,[role="combobox"],[role="spinbutton"]')) {
      if ((el.type || '').toLowerCase() === 'hidden' || !rendered(el)) continue;
      const key = labelFor(el) || clean(el.name || el.id);
      if (!key) continue;
      if (el.type === 'radio') {
        if (el.checked) values[key] = el.value;
        else if (!(key in values)) values[key] = null;
      } else if (el.type === 'checkbox') values[key] = !!el.checked;
      else values[key] = 'value' in el ? el.value : el.getAttribute?.('aria-valuenow') ?? null;
    }

    const regions = {};
    for (const el of scope.querySelectorAll('section,fieldset,[role="region"],div')) {
      const label = regionLabel(el);
      if (label && rendered(el)) regions[label] = { visible: visible(el) };
    }

    const validations = [];
    const validationSelectors = '[role="alert"],[aria-live="assertive"],[aria-live="polite"],mat-error,.mat-mdc-form-field-error,.error,.validation-error';
    for (const el of scope.querySelectorAll(validationSelectors)) {
      if (!visible(el)) continue;
      const message = clean(el.innerText || el.textContent);
      if (message && !validations.includes(message)) validations.push(message);
    }

    const options = {};
    for (const el of scope.querySelectorAll('select,[role="combobox"]')) {
      if (!rendered(el)) continue;
      const key = labelFor(el) || clean(el.name || el.id);
      if (!key) continue;
      let valuesForInput = optionsFor(el);
      const controlledId = el.getAttribute?.('aria-controls');
      if (controlledId) {
        const controlled = document.getElementById(controlledId);
        if (controlled) {
          const dynamic = Array.from(controlled.querySelectorAll('[role="option"],option,li')).filter(visible).map((option) => clean(option.getAttribute?.('data-value') || option.getAttribute?.('value') || option.innerText || option.textContent)).filter(Boolean);
          if (dynamic.length) valuesForInput = dynamic;
        }
      }
      if (valuesForInput.length) options[key] = valuesForInput;
    }

    return {
      page: pageLabel,
      url: location.href,
      title: document.title,
      dom,
      values,
      regions,
      validations,
      options,
      overlay: blockingOverlay ? { active: true, text: overlayText.slice(0, 1200) } : { active: false }
    };
  });
}

export async function installUserEventProbe(page) {
  await page.evaluate(() => {
    window.__lemapWebEvents = [];
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const textWithoutControls = (el) => {
      if (!el) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll?.('input,select,textarea,button,a,[role="button"],[role="link"],[role="radio"],[role="checkbox"],[role="textbox"],[role="combobox"],[role="spinbutton"],[role="listbox"],option').forEach((node) => node.remove());
      return clean(clone.textContent || '');
    };
    const labelFor = (el) => {
      if (!el) return '';
      const associated = el.labels?.length ? Array.from(el.labels) : [];
      const closest = el.closest?.('label');
      if (closest && !associated.includes(closest)) associated.push(closest);
      const associatedText = clean(associated.map(textWithoutControls).filter(Boolean).join(' '));
      if (associatedText) return associatedText;
      const aria = el.getAttribute?.('aria-label');
      if (aria) return clean(aria);
      const tag = el.tagName?.toLowerCase();
      const role = clean(el.getAttribute?.('role') || '').toLowerCase();
      if (tag === 'button' || role === 'button' || tag === 'a' || role === 'link') {
        const controlText = clean(el.innerText || el.textContent);
        if (controlText) return controlText;
      }
      return clean(el.getAttribute?.('placeholder') || el.getAttribute?.('title') || el.name || el.id || '');
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
