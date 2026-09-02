import crypto from 'node:crypto';

function hash(value) { return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12); }

function normalizeRoute(url) {
  try {
    const u = new URL(url);
    const hashRoute = (u.hash || '').replace(/\?.*$/, '');
    return `${u.pathname}${hashRoute}` || '/';
  } catch {
    return String(url || '').split('?')[0];
  }
}

export function buildEntityIdentity(snapshot = {}, root = snapshot.dom || {}) {
  let origin = '';
  try { origin = new URL(snapshot.url || '').origin; } catch {}
  const route = normalizeRoute(snapshot.url || '');
  const label = String(root?.label || snapshot.page || snapshot.title || '').trim();
  const rootTag = String(root?.tag || '').toLowerCase();
  const overlay = !!snapshot.overlay?.active;
  const fingerprint = hash(JSON.stringify({ route, label, rootTag, overlay }));
  return {
    id: `entity:${fingerprint}`,
    type: 'structural_entity',
    label,
    presentation: {
      pageId: `page:${fingerprint}`,
      url: String(snapshot.url || ''),
      route,
      origin,
      title: String(snapshot.title || ''),
      rootTag,
      overlay,
      overlayText: overlay ? String(snapshot.overlay?.text || '').slice(0, 1200) : '',
      structuralFingerprint: fingerprint
    }
  };
}
