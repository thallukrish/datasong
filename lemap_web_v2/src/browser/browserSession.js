export function chooseActivePage(pages = []) {
  const list = Array.isArray(pages) ? pages : [];
  const normal = list.filter((page) => /^https?:/i.test(String(page?.url?.() || '')));
  return normal.at(-1) || list.at(-1) || null;
}

export async function connectBrowserSession({ config, chromium } = {}) {
  const endpoint = String(config?.browser?.cdpUrl || '').trim();
  if (!endpoint) throw new Error('Browser CDP URL is required.');
  if (!chromium || typeof chromium.connectOverCDP !== 'function') throw new Error('A Chromium CDP connector is required.');

  const browser = await chromium.connectOverCDP(endpoint);
  try {
    const contexts = typeof browser.contexts === 'function' ? browser.contexts() : [];
    const pages = contexts.flatMap((context) => typeof context?.pages === 'function' ? context.pages() : []);
    const page = chooseActivePage(pages);
    if (!page) throw new Error('No Chrome tabs found on the CDP connection.');

    let closed = false;
    return {
      browser,
      page,
      endpoint,
      close: async () => {
        if (closed) return;
        closed = true;
        await browser.close();
      }
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
