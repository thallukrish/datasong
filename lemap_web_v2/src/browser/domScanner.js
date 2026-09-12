export function scanDomTree(root) {
  const safeAttributes = new Set([
    'id',
    'name',
    'type',
    'role',
    'class',
    'href',
    'for',
    'title',
    'placeholder',
    'required',
    'disabled',
    'aria-label',
    'aria-labelledby',
    'aria-describedby',
    'aria-modal',
    'aria-required',
    'aria-disabled',
    'aria-expanded',
    'aria-controls'
  ]);

  const ignoredTags = new Set([
    'script',
    'style',
    'template',
    'noscript',
    'meta',
    'link',
    'head'
  ]);

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  const isVisible = (element) => {
    if (!element || element.nodeType !== 1) return false;
    if (element.hasAttribute?.('hidden')) return false;
    if (element.getAttribute?.('aria-hidden') === 'true') return false;

    const view = element.ownerDocument?.defaultView;
    const style = view?.getComputedStyle?.(element);
    if (style && (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse')) return false;

    const rect = element.getBoundingClientRect?.();
    if (rect && rect.width <= 0 && rect.height <= 0) return false;
    return true;
  };

  const directText = (element) => clean(
    Array.from(element.childNodes || [])
      .filter((node) => node?.nodeType === 3)
      .map((node) => node.textContent || '')
      .join(' ')
  );

  const structuralAttributes = (element) => {
    const attributes = {};
    for (const attribute of Array.from(element.attributes || [])) {
      const name = String(attribute?.name || '').toLowerCase();
      if (!safeAttributes.has(name)) continue;
      attributes[name] = clean(attribute?.value || '');
    }
    return attributes;
  };

  const visit = (element) => {
    if (!element || element.nodeType !== 1) return null;
    const tag = String(element.tagName || '').toLowerCase();
    if (!tag || ignoredTags.has(tag) || !isVisible(element)) return null;

    const children = Array.from(element.children || [])
      .map(visit)
      .filter(Boolean);

    return {
      tag,
      directText: directText(element),
      attributes: structuralAttributes(element),
      children
    };
  };

  return visit(root);
}

export async function captureVisibleDom(page) {
  if (!page?.locator) throw new Error('A browser page with locator() is required.');
  const body = await page.locator('body').elementHandle();
  if (!body) throw new Error('Could not resolve the page body.');

  const [root, title] = await Promise.all([
    body.evaluate(scanDomTree),
    page.title?.() ?? ''
  ]);

  return {
    version: 1,
    url: String(page.url?.() || ''),
    title: String(title || ''),
    root
  };
}
