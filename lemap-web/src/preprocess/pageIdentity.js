import crypto from 'node:crypto';

function normalizeRoute(url) {
  try {
    const u = new URL(url);
    const hash = (u.hash || '').replace(/\?.*$/, '');
    return `${u.pathname}${hash}` || '/';
  } catch {
    return String(url || '').split('?')[0];
  }
}

function hash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

export function buildPageIdentity(snapshot = {}) {
  let origin = '';
  try { origin = new URL(snapshot.url || '').origin; } catch {}
  const route = normalizeRoute(snapshot.url || '');
  const mainLabel = String(snapshot.page || snapshot.dom?.label || '').trim();
  const stableRoot = String(snapshot.dom?.tag || '').toLowerCase();
  const structuralFingerprint = hash(JSON.stringify({ route, mainLabel, stableRoot }));
  return {
    id: `page:${structuralFingerprint}`,
    url: String(snapshot.url || ''),
    route,
    origin,
    title: String(snapshot.title || ''),
    mainLabel,
    stableRoot,
    structuralFingerprint
  };
}
