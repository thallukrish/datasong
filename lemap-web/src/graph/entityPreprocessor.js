import { buildEntityIdentity } from './entityIdentity.js';
import { selectEntityRoot } from './entityRoot.js';
import { discoverInputs } from '../preprocess/inputDiscovery.js';
import { discoverGroups } from '../preprocess/groupDiscovery.js';

export function preprocessEntity(snapshot = {}) {
  const root = selectEntityRoot(snapshot.dom || {});
  const entity = buildEntityIdentity(snapshot, root);
  const controls = discoverInputs(root, entity.id);
  const groups = discoverGroups(controls, entity.id);
  const fields = controls.filter((control) => !['button', 'link'].includes(control.type));
  const actions = controls.filter((control) => ['button', 'link'].includes(control.type));

  return {
    version: 3,
    entity,
    fields,
    actions,
    groups
  };
}
