import fs from 'node:fs/promises';
import path from 'node:path';

const pickList = (text, key) => {
  const m = text.match(new RegExp(`["']${key}["']\\s*:\\s*\\[([\\s\\S]*?)\\]`));
  return m ? [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]) : [];
};

const pickBool = (text, key, fallback) => {
  const m = text.match(new RegExp(`["']${key}["']\\s*:\\s*(True|False)`));
  return m ? m[1] === 'True' : fallback;
};

const pickString = (text, key) => {
  const m = text.match(new RegExp(`["']${key}["']\\s*:\\s*["']([^"']+)["']`));
  return m ? m[1] : '';
};

export function parseOdooManifestText(text = '') {
  return {
    name: pickString(text, 'name'),
    version: pickString(text, 'version'),
    depends: pickList(text, 'depends'),
    data: pickList(text, 'data'),
    application: pickBool(text, 'application', false),
    installable: pickBool(text, 'installable', true)
  };
}

export async function detectOdooRepository({ repoDir, trackedFiles = [] }) {
  const manifests = trackedFiles.filter((file) => /(?:^|\/)__manifest__\.py$/.test(file));
  const addons = [];
  let version = '';

  for (const manifestPath of manifests) {
    const text = await fs.readFile(path.join(repoDir, manifestPath), 'utf8');
    const addonName = manifestPath.split('/').slice(-2, -1)[0];
    const parsed = parseOdooManifestText(text);
    if (!version && /^\d+\./.test(parsed.version)) version = parsed.version.split('.')[0];
    addons.push({
      name: addonName,
      manifestPath,
      depends: parsed.depends,
      data: parsed.data,
      application: parsed.application,
      installable: parsed.installable
    });
  }

  return { detected: addons.length > 0, version, addons };
}
