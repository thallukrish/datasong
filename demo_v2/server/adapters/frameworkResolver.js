import { createMoquiAdapters } from './moqui/index.js';
import { createOdooAdapters } from './odoo/index.js';
import { detectOdooRepository } from './odoo/detect.js';

const genericAdapters = () => ({ entitySchema: null, execution: null });

export async function resolveFrameworkAdapters(topology, overrides = {}) {
  const detectOdoo = overrides.detectOdoo || detectOdooRepository;
  const createOdoo = overrides.createOdoo || createOdooAdapters;
  const createMoqui = overrides.createMoqui || createMoquiAdapters;
  const detection = await detectOdoo({
    repoDir: topology?.repoDir || '',
    trackedFiles: Array.isArray(topology?.trackedFiles) ? topology.trackedFiles : []
  });

  if (detection?.detected) {
    return { kind: 'odoo', detection, adapters: createOdoo(topology) };
  }

  const trackedFiles = Array.isArray(topology?.trackedFiles) ? topology.trackedFiles : [];
  const isMoqui = trackedFiles.some((file) => /(?:^|\/)component\.xml$/.test(file));
  if (isMoqui) {
    return {
      kind: 'moqui',
      detection: { detected: true, evidence: 'component.xml' },
      adapters: createMoqui(topology)
    };
  }

  return {
    kind: 'generic',
    detection: { detected: false },
    adapters: genericAdapters()
  };
}
