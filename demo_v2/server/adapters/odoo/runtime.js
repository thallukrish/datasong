import { detectOdooRepository } from './detect.js';
import { createOdooAdapters } from './index.js';

export async function resolveOdooRuntime(topology, overrides = {}) {
  const detectOdoo = overrides.detectOdoo || detectOdooRepository;
  const createOdoo = overrides.createOdoo || createOdooAdapters;
  const detection = await detectOdoo({
    repoDir: topology?.repoDir || '',
    trackedFiles: Array.isArray(topology?.trackedFiles) ? topology.trackedFiles : []
  });
  if (!detection?.detected) return null;
  return { detection, adapters: createOdoo(topology) };
}
