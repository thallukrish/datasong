function arr(value) { return Array.isArray(value) ? value : []; }

function methodAction(graph, fieldId) {
  return arr(graph?.methods).find((method) => method.fieldId === fieldId)?.actions?.[0] || null;
}

export async function collectNavigationCandidates(page, graph = {}) {
  const buttonCandidates = arr(graph.actions).map((field) => {
    const action = methodAction(graph, field.id);
    return {
      id: action?.id || `candidate:${field.id}`,
      fieldId: field.id,
      label: field.label,
      kind: 'action',
      href: '',
      visible: !!field.visible,
      enabled: !!field.visible && !field.disabled,
      safety: action?.safety || 'policy-required',
      presentation: { domId: field.domId || '', name: field.name || '', role: field.role || '', tag: field.tag || '' }
    };
  });

  if (graph.entity?.presentation?.overlay) return buttonCandidates;

  const links = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('a[href],[role="link"]'))
      .filter(visible)
      .map((el, index) => ({
        id: `link:${index + 1}`,
        label: clean(el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('title') || ''),
        href: clean(el.href || el.getAttribute('href') || ''),
        domId: clean(el.id || ''),
        role: clean(el.getAttribute('role') || ''),
        tag: String(el.tagName || '').toLowerCase()
      }))
      .filter((item) => item.label || item.href);
  });

  const linkCandidates = links.map((link) => ({
    id: link.id,
    fieldId: '',
    label: link.label,
    kind: 'link',
    href: link.href,
    visible: true,
    enabled: true,
    safety: 'policy-required',
    presentation: { domId: link.domId, name: '', role: link.role, tag: link.tag }
  }));

  const seen = new Set();
  return [...buttonCandidates, ...linkCandidates].filter((candidate) => {
    const key = `${candidate.kind}|${candidate.label}|${candidate.href}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
