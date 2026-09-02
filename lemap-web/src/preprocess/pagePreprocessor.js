import { buildPageIdentity } from './pageIdentity.js';
import { discoverInputs } from './inputDiscovery.js';
import { discoverGroups } from './groupDiscovery.js';
import { buildInputHierarchy } from './hierarchy.js';
import { scannerFor } from './scanners/registry.js';
import { selectActiveWorkflowRoot } from './activeWorkflow.js';

export function preprocessPage(snapshot = {}) {
  const page = buildPageIdentity(snapshot);
  const activeRoot = selectActiveWorkflowRoot(snapshot.dom || {});
  const inputs = discoverInputs(activeRoot, page.id);
  const groups = discoverGroups(inputs, page.id);
  const hierarchy = buildInputHierarchy(inputs, page);
  const actionPlans = inputs.map((input) => ({
    inputId: input.id,
    inputLabel: input.label,
    inputType: input.type,
    groupId: input.parentGroupId || '',
    executableNow: input.visible && !input.disabled && input.type !== 'file',
    actions: scannerFor(input).actions(input)
  }));
  return {
    version: 1,
    page,
    activeWorkflow: {
      tag: String(activeRoot?.tag || ''),
      label: String(activeRoot?.label || page.mainLabel || '')
    },
    hierarchy,
    inputs,
    groups,
    actionPlans
  };
}
