import crypto from 'node:crypto';

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function hash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 16);
}

function pageLocation(url = '') {
  try {
    const parsed = new URL(String(url));
    const hashRoute = String(parsed.hash || '').replace(/\?.*$/, '');
    return {
      origin: parsed.origin,
      route: `${parsed.pathname}${hashRoute}` || '/'
    };
  } catch {
    return {
      origin: '',
      route: String(url || '').split('?')[0]
    };
  }
}

function emptyEntity({ id, type, name, structural }) {
  return {
    id,
    type,
    name: clean(name),
    structural,
    semantic: {},
    links: []
  };
}

export function createPageEntity(snapshot = {}) {
  const location = pageLocation(snapshot.url);
  const title = clean(snapshot.title);
  const id = `page:${hash(`${location.origin}|${location.route}`)}`;

  return emptyEntity({
    id,
    type: 'page',
    name: title || location.route || 'Page',
    structural: {
      origin: location.origin,
      route: location.route,
      title
    }
  });
}

function nodeName(node = {}) {
  const attributes = node.attributes || {};
  return clean(
    node.directText
    || attributes['aria-label']
    || attributes.title
    || attributes.id
    || node.tag
  );
}

function pathValue(path = []) {
  return Array.isArray(path) ? path.map((item) => Number(item)) : [];
}

function structuralIdentity({ pageId, path, node, parsedControl }) {
  const attributes = node?.attributes || {};
  return JSON.stringify({
    pageId: clean(pageId),
    path: pathValue(path),
    tag: clean(node?.tag).toLowerCase(),
    domId: clean(attributes.id),
    name: clean(parsedControl?.name || attributes.name),
    controlType: clean(parsedControl?.controlType)
  });
}

export function createStructuralEntity({
  pageId = '',
  path = [],
  node = {},
  parsedControl = null
} = {}) {
  if (!clean(pageId)) throw new Error('pageId is required');
  const tag = clean(node?.tag).toLowerCase();
  if (!tag) throw new Error('node.tag is required');

  const attributes = node.attributes || {};
  const entityPath = pathValue(path);
  const id = `entity:${hash(structuralIdentity({ pageId, path: entityPath, node, parsedControl }))}`;

  if (parsedControl) {
    return emptyEntity({
      id,
      type: 'ui_control',
      name: parsedControl.label,
      structural: {
        controlType: clean(parsedControl.controlType),
        tag,
        role: clean(parsedControl.role),
        domId: clean(attributes.id),
        name: clean(parsedControl.name),
        label: clean(parsedControl.label),
        href: clean(parsedControl.href),
        disabled: parsedControl.disabled === true,
        required: parsedControl.required === true,
        sourceAdapter: clean(parsedControl.sourceAdapter),
        path: entityPath
      }
    });
  }

  return emptyEntity({
    id,
    type: 'container',
    name: nodeName(node),
    structural: {
      tag,
      role: clean(attributes.role),
      domId: clean(attributes.id),
      path: entityPath
    }
  });
}
